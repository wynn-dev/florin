import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"
import {
  ECB_FILES,
  chooseFile,
  fxNeeds,
  fxStatus,
  parseEcbXml,
  refreshRates,
} from "@/server/ecb"
import { getJob, runJobNow } from "@/server/jobs"
import "@/server/job-list"
import type { EcbFile } from "@/server/ecb"

useTempHome()

const fixture = (file: EcbFile) =>
  readFileSync(
    new URL(`fixtures/ecb/${ECB_FILES[file]}`, import.meta.url),
    "utf8"
  )

/** A fake ECB that serves the saved samples and remembers what was asked. */
function fakeEcb(overrides: Partial<Record<EcbFile, string>> = {}) {
  const fetched: EcbFile[] = []
  const fetchXml = (file: EcbFile) => {
    fetched.push(file)
    return Promise.resolve(overrides[file] ?? fixture(file))
  }
  return { fetched, fetchXml }
}

const rateChanges = () =>
  data.listActivity({ limit: 100 }).items.filter((c) => c.entity === "fx rate")

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-12T10:00:00Z"), toFake: ["Date"] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("ECB parsing", () => {
  test("reads the daily file and the history files", () => {
    expect(parseEcbXml(fixture("daily"))).toEqual([
      { date: "2026-11-11", currency: "USD", rate: 1.159 },
      { date: "2026-11-11", currency: "JPY", rate: 178.37 },
      { date: "2026-11-11", currency: "GBP", rate: 0.8801 },
    ])
    const hist = parseEcbXml(fixture("hist-90d"))
    expect(hist).toHaveLength(24)
    expect(hist.at(-1)).toEqual({
      date: "2026-08-14",
      currency: "GBP",
      rate: 0.8655,
    })
    expect(() => parseEcbXml("<html>busy</html>")).toThrow("no rates")
  })

  test("picks the smallest file that reaches back far enough", () => {
    expect(chooseFile("2026-11-01", "2026-11-12")).toBe("hist-90d")
    expect(chooseFile("2026-08-24", "2026-11-12")).toBe("hist-90d")
    expect(chooseFile("2026-08-23", "2026-11-12")).toBe("hist")
    expect(chooseFile("2024-02-24", "2026-11-12")).toBe("hist")
  })
})

describe("refreshing rates", () => {
  test("fetches nothing while every account is in the budget's currency", async () => {
    data.createAccount("person", {
      name: "Current",
      type: "checking",
      startingBalance: 1000,
    })
    expect(fxNeeds().currencies).toEqual([])
    const ecb = fakeEcb()
    await refreshRates(ecb.fetchXml)
    expect(ecb.fetched).toEqual([])
    expect(fxStatus().currencies).toEqual([])
  })

  let usd: number

  test("backfills from the 90-day file, keeping only the currencies in use", async () => {
    usd = data.createAccount("person", {
      name: "Brokerage",
      type: "investment",
      currency: "USD",
      startingBalance: 100_000,
      startingDate: "2026-10-01",
    }).id
    expect(fxNeeds()).toEqual({ currencies: ["USD"], earliest: "2026-10-01" })

    const ecb = fakeEcb()
    await refreshRates(ecb.fetchXml)
    expect(ecb.fetched).toEqual(["daily", "hist-90d"])
    // From a week before the earliest transaction, so a weekend there finds a rate.
    expect(data.rateOn("USD", "2026-09-24")).toBeNull()
    expect(data.rateOn("USD", "2026-09-25")).toBe(1.165)
    expect(data.rateOn("USD", "2026-11-11")).toBe(1.159)
    expect(data.rateOn("GBP", "2026-11-11")).toBeNull()
    expect(data.rateOn("JPY", "2026-11-11")).toBeNull()
    expect(fxStatus().currencies).toEqual([
      { currency: "USD", latestDate: "2026-11-11" },
    ])

    // The rates don't flood the activity list.
    expect(rateChanges()).toEqual([])

    // Up to date: the next run only reads the small daily file.
    const again = fakeEcb()
    await refreshRates(again.fetchXml)
    expect(again.fetched).toEqual(["daily"])
  })

  test("a weekend converts at the Friday before, through convert()", () => {
    // Sunday 8 Nov: Friday 6 Nov's 1.15 USD per EUR.
    expect(data.convert(11_500, "USD", "EUR", "2026-11-08")).toBe(10_000)
    expect(data.convert(10_000, "EUR", "USD", "2026-11-07")).toBe(11_500)
    // Monday has its own rate.
    expect(data.convert(11_548, "USD", "EUR", "2026-11-09")).toBe(10_000)
  })

  test("an older transaction backfills from the full history file", async () => {
    data.createTransaction("person", {
      accountId: usd,
      date: "2024-03-02", // a Saturday
      amount: -5000,
    })
    const ecb = fakeEcb()
    await refreshRates(ecb.fetchXml)
    expect(ecb.fetched).toEqual(["daily", "hist"])
    expect(data.rateOn("USD", "2024-02-23")).toBeNull() // before the week of margin
    expect(data.convert(10_830, "USD", "EUR", "2024-03-02")).toBe(10_000)

    const again = fakeEcb()
    await refreshRates(again.fetchXml)
    expect(again.fetched).toEqual(["daily"])
  })

  test("missed working days are filled from the 90-day file", async () => {
    // Monday 16 Nov, with Friday's daily file: Thursday 12 Nov was never stored.
    vi.setSystemTime(new Date("2026-11-16T10:00:00Z"))
    const daily = fixture("daily")
      .replace("2026-11-11", "2026-11-13")
      .replace("1.1590", "1.1620")
    const ecb = fakeEcb({ daily })
    await refreshRates(ecb.fetchXml)
    expect(ecb.fetched).toEqual(["daily", "hist-90d"])
    expect(data.rateOn("USD", "2026-11-15")).toBe(1.162)
  })

  test("a currency the ECB doesn't publish is an error, the others still arrive", async () => {
    const ars = data.createAccount("person", {
      name: "Pesos",
      type: "cash",
      currency: "ARS",
    })
    const daily = fixture("daily")
      .replace("2026-11-11", "2026-11-12")
      .replace("1.1590", "1.1600")
    const ecb = fakeEcb({ daily })
    await expect(refreshRates(ecb.fetchXml)).rejects.toThrow(
      "the ECB publishes no rates for ARS"
    )
    expect(data.rateOn("USD", "2026-11-12")).toBe(1.16)
    expect(ecb.fetched).toEqual(["daily"])
    data.deleteAccount("person", ars.id)
  })

  test("the ecb job fetches the ECB's files and records how it went", async () => {
    const urls: string[] = []
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url)
      const file = (Object.keys(ECB_FILES) as EcbFile[]).find((f) =>
        url.endsWith(`/${ECB_FILES[f]}`)
      )!
      return Promise.resolve(new Response(fixture(file)))
    })
    const status = await runJobNow("ecb")
    expect(urls).toEqual([
      "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
    ])
    expect(status).toMatchObject({
      name: "ecb",
      lastError: null,
      lastSuccessAt: "2026-11-12T10:00:00.000Z",
    })
    expect(fxStatus().job).toEqual(getJob("ecb"))

    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response("down", { status: 503 }))
    )
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect((await runJobNow("ecb")).lastError).toBe(
      "the ECB answered 503 for eurofxref-daily.xml"
    )
  })
})
