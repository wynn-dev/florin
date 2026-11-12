import { readFileSync } from "node:fs"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest"
import { useTempHome } from "../setup"
import { FAKE_QUERY, FAKE_TOKEN, flexError, startFakeFlex } from "./fake-flex"
import type { FakeFlex } from "./fake-flex"
import * as data from "@/server/data"
import { getSecret } from "@/server/secrets"
import { callTool } from "@/server/mcp/tool"
import { tools } from "@/server/mcp/tools"
import { POLL_DELAYS_MS, fetchFlexReport } from "@/server/ibkr/client"
import { IbkrError } from "@/server/ibkr/errors"
import {
  TOKEN_KEY,
  TooSoon,
  clientOptions,
  connectIbkr,
  disconnectIbkr,
  getIbkrStatus,
  pullIbkr,
  scheduledIbkrPull,
} from "@/server/ibkr/sync"

useTempHome()

const report = readFileSync(
  new URL("../fixtures/ibkr/flex-report.xml", import.meta.url),
  "utf8"
)
let fake: FakeFlex
let now = Date.parse("2026-11-12T10:00:00Z")
const slept: number[] = []

/** Moves the clock past IBKR's one-pull-a-minute spacing. */
const later = (ms = 61_000) => {
  now += ms
  vi.setSystemTime(now)
}

beforeAll(async () => {
  fake = await startFakeFlex(report)
  process.env.FLORIN_IBKR_FLEX_URL = fake.url
  clientOptions.sleep = (ms) => {
    slept.push(ms)
    return Promise.resolve()
  }
})
afterAll(async () => {
  delete process.env.FLORIN_IBKR_FLEX_URL
  await fake.close()
})
beforeEach(() => {
  vi.useFakeTimers({ now, toFake: ["Date"] })
  fake.calls.length = 0
  fake.generating = 1
  fake.report = report
  slept.length = 0
})
afterEach(() => {
  vi.useRealTimers()
})

const request = { token: FAKE_TOKEN, queryId: FAKE_QUERY }
const options = { sleep: () => Promise.resolve() }

describe("the Flex Web Service client", () => {
  test("SendRequest, then GetStatement until the report is ready", async () => {
    fake.generating = 2
    const xml = await fetchFlexReport(request, {
      sleep: (ms) => (slept.push(ms), Promise.resolve()),
    })
    expect(xml).toBe(report)
    expect(fake.calls.map((c) => c.endpoint)).toEqual([
      "SendRequest",
      "GetStatement",
      "GetStatement",
      "GetStatement",
    ])
    expect(fake.calls[0].params).toEqual({ t: "set", q: FAKE_QUERY, v: "3" })
    expect(fake.calls[1].params.q).toBe("7351902649")
    expect(fake.calls.every((c) => c.userAgent?.startsWith("florin/"))).toBe(
      true
    )
    expect(slept).toEqual(POLL_DELAYS_MS.slice(0, 3))
  })

  test("asks for a number of days when given one", async () => {
    await fetchFlexReport({ ...request, days: 6 }, options)
    expect(fake.calls[0].params.p).toBe("6")
  })

  test("gives up after about three minutes of 'still generating'", async () => {
    fake.generating = 100
    const error = await fetchFlexReport(request, options).catch((e) => e)
    expect(error).toBeInstanceOf(IbkrError)
    expect(error.message).toBe(
      "IBKR is still preparing the report. Try again later."
    )
    expect(fake.calls).toHaveLength(1 + POLL_DELAYS_MS.length)
    expect(POLL_DELAYS_MS.reduce((s, d) => s + d, 0)).toBeLessThanOrEqual(
      200_000
    )
  })

  test.each([
    [1012, "Token has expired.", "stop", "token has expired"],
    [1015, "Token is invalid.", "stop", "doesn't accept this Flex token"],
    [1014, "Query is invalid.", "stop", "can't find this Flex query"],
    [
      1011,
      "Service account is inactive.",
      "stop",
      "Flex Web Service is turned off",
    ],
    [1013, "IP restriction.", "stop", "IP addresses"],
    [
      1010,
      "Legacy Flex Queries are no longer supported.",
      "stop",
      "Activity Flex Query",
    ],
    [1020, "Invalid request.", "stop", "refused the request"],
    [1018, "Too many requests.", "throttled", "too many requests"],
    [1025, "Too many failed attempts.", "blocked", "until tomorrow"],
    [1009, "Server under heavy load.", "retry", "Try again later"],
    [1006, "FIFO data not ready.", "retry", "about an hour"],
  ])(
    "error %i from SendRequest is reported once, never retried",
    async (code, message, kind, words) => {
      fake.queue.SendRequest.push(flexError(code, message))
      const error = await fetchFlexReport(request, options).catch((e) => e)
      expect(error).toBeInstanceOf(IbkrError)
      expect(error.kind).toBe(kind)
      expect(error.code).toBe(code)
      expect(error.message).toContain(words)
      expect(error.message).not.toContain(FAKE_TOKEN)
      expect(fake.calls).toHaveLength(1)
    }
  )

  test("a stop error from GetStatement is not retried either", async () => {
    fake.queue.GetStatement.push(flexError(1012, "Token has expired."))
    const error = await fetchFlexReport(request, options).catch((e) => e)
    expect(error.kind).toBe("stop")
    expect(fake.calls.map((c) => c.endpoint)).toEqual([
      "SendRequest",
      "GetStatement",
    ])
  })

  test("an invalid reference code starts over once", async () => {
    fake.queue.GetStatement.push(flexError(1017, "Reference code is invalid."))
    await expect(fetchFlexReport(request, options)).resolves.toBe(report)
    expect(fake.calls.map((c) => c.endpoint)).toEqual([
      "SendRequest",
      "GetStatement",
      "SendRequest",
      "GetStatement",
      "GetStatement",
    ])
  })

  test("an unreachable service says so", async () => {
    const error = await fetchFlexReport(request, {
      ...options,
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
    }).catch((e) => e)
    expect(error.message).toContain("couldn't reach IBKR")
  })
})

describe("connecting and pulling", () => {
  const ibkrChanges = () =>
    data.listActivity({ actor: "ibkr", limit: 100 }).items

  test("a wrong token is refused and not saved", async () => {
    await expect(
      connectIbkr("person", { token: "9999999999999999", queryId: FAKE_QUERY })
    ).rejects.toThrow("doesn't accept this Flex token")
    expect(getSecret(TOKEN_KEY)).toBeUndefined()
    const status = getIbkrStatus()
    expect(status.configured).toBe(false)
    expect(status.lastError).toBeNull()
    expect(data.listAccounts()).toHaveLength(0)
    later()
  })

  test("refuses input that can't be a token or query id", async () => {
    await expect(
      connectIbkr("person", { token: "abc", queryId: FAKE_QUERY })
    ).rejects.toThrow(data.InvalidInput)
    await expect(
      connectIbkr("person", { token: FAKE_TOKEN, queryId: "my query" })
    ).rejects.toThrow("number IBKR shows")
    expect(fake.calls).toHaveLength(0)
  })

  test("the first pull creates the account with its values, holdings and activity", async () => {
    const status = await connectIbkr("person", {
      token: FAKE_TOKEN,
      queryId: FAKE_QUERY,
    })
    expect(fake.calls[0].params.p).toBeUndefined()
    expect(getSecret(TOKEN_KEY)).toBe(FAKE_TOKEN)
    expect(status).toMatchObject({
      configured: true,
      token: { set: true },
      queryId: FAKE_QUERY,
      lastReportAt: "2026-11-12T08:15:44.000Z",
      lastError: null,
      missingSections: [],
      running: false,
    })
    expect(JSON.stringify(status)).not.toContain(FAKE_TOKEN)
    expect(status.accounts).toEqual([
      {
        id: expect.any(Number),
        name: "Interactive Brokers",
        maskedId: "U•••O001",
        currency: "USD",
        value: 9_537_002,
        asOf: "2026-11-11",
      },
    ])
    const account = data.getAccount(status.accounts[0].id)
    expect(account).toMatchObject({
      type: "investment",
      currency: "USD",
      onBudget: false,
      provider: "ibkr",
      externalId: "UDEMO001",
      balance: 9_537_002,
    })
    expect(data.listAccountValues(account.id)).toHaveLength(262)
    const holdings = data.listHoldings(account.id)
    expect(holdings).toHaveLength(8)
    expect(holdings.filter((h) => h.assetClass === "cash")).toHaveLength(2)
    expect(
      data.listTransactions({ accountId: account.id, limit: 500 }).total
    ).toBe(95)
    // one line for the whole pull
    expect(ibkrChanges()).toHaveLength(1)
    expect(ibkrChanges()[0].summary).toBe(
      "Added Interactive Brokers from IBKR: 95 new transactions, 8 holdings, worth $95,370.02 on 2026-11-11"
    )
  })

  test("the account is worth its latest value, not the sum of its transactions", () => {
    const [account] = data.listAccounts()
    const sum = data
      .listTransactions({ accountId: account.id, limit: 500 })
      .items.reduce((s, t) => s + t.amount, 0)
    expect(sum).not.toBe(9_537_002)
    expect(account.balance).toBe(9_537_002)
    expect(account.clearedBalance).toBe(9_537_002)
  })

  test("it counts in net worth converted at the ECB rate", () => {
    data.saveFxRates(null, [
      { date: "2026-11-11", currency: "USD", rate: 1.159 },
    ])
    const [account] = data.listAccounts()
    // 95,370.02 USD / 1.159 USD per EUR
    expect(account.budgetBalance).toBe(8_228_647)
    const point = data
      .netWorth({ from: "2026-11-01", to: "2026-11-11" })
      .at(-1)!
    expect(point.netWorth).toBe(8_228_647)
    // tracking only: none of its rows are budget activity
    expect(data.getBudgetMonth("2026-11").activity).toBe(0)
  })

  test("pulls are spaced a minute apart", async () => {
    const error = await pullIbkr().catch((e) => e)
    expect(error).toBeInstanceOf(TooSoon)
    expect(error.message).toMatch(/next is allowed in \d+ s/)
    expect(getIbkrStatus().nextPullAllowedAt).toBe(
      new Date(now + 60_000).toISOString()
    )
    expect(fake.calls).toHaveLength(0)
  })

  test("a second pull adds nothing and asks only for the recent days", async () => {
    later()
    const [account] = data.listAccounts()
    await pullIbkr()
    // last report ended 2026-11-11; today is 2026-11-12, plus three days' overlap
    expect(fake.calls[0].params.p).toBe("4")
    expect(
      data.listTransactions({ accountId: account.id, limit: 500 }).total
    ).toBe(95)
    expect(data.listAccountValues(account.id)).toHaveLength(262)
    expect(data.listHoldings(account.id)).toHaveLength(8)
    expect(data.listAccounts()).toHaveLength(1)
    expect(ibkrChanges()[0].summary).toMatch(
      /^Updated Interactive Brokers from IBKR: 0 new transactions/
    )
  })

  test("a correction arrives as a new transaction id and is added", async () => {
    later()
    const original =
      /<CashTransaction [^>]*transactionID="31877410786"[^>]*\/>/.exec(
        report
      )![0]
    const reversal = original
      .replace('transactionID="31877410786"', 'transactionID="31877499001"')
      .replace('amount="-1.56"', 'amount="1.56"')
      .replace(/reportDate="\d+"/, 'reportDate="20261111"')
    fake.report = report.replace(original, original + "\n" + reversal)
    const [account] = data.listAccounts()
    await pullIbkr()
    const rows = data
      .listTransactions({
        accountId: account.id,
        search: "withholding",
        limit: 500,
      })
      .items.filter((t) => t.payeeName === "AAPL withholding tax")
    expect(rows.map((t) => t.amount).sort()).toContain(156)
    expect(
      data.listTransactions({ accountId: account.id, limit: 500 }).total
    ).toBe(96)
  })

  test("a query without some sections keeps the holdings and says what to tick", async () => {
    later()
    fake.report = readFileSync(
      new URL("../fixtures/ibkr/flex-report-missing.xml", import.meta.url),
      "utf8"
    )
    const status = await pullIbkr()
    expect(status.missingSections).toEqual([
      "Cash Report",
      "Open Positions",
      "Trades",
    ])
    expect(data.listHoldings(status.accounts[0].id)).toHaveLength(8)
  })

  test("an expired token is reported and stops the daily pull until it changes", async () => {
    later()
    fake.expiredToken = FAKE_TOKEN
    await expect(pullIbkr()).rejects.toThrow("token has expired")
    const status = getIbkrStatus()
    expect(status.lastError).toContain("Your IBKR Flex token has expired")
    later()
    fake.calls.length = 0
    await scheduledIbkrPull()
    expect(fake.calls).toHaveLength(0)
    // a new token (here: the same one, valid again) clears it
    fake.expiredToken = undefined
    await connectIbkr("person", { token: FAKE_TOKEN, queryId: FAKE_QUERY })
    expect(getIbkrStatus().lastError).toBeNull()
    later()
    fake.calls.length = 0
    await scheduledIbkrPull()
    expect(fake.calls.length).toBeGreaterThan(0)
  })

  test("too many failed attempts stop pulls until tomorrow", async () => {
    later()
    fake.queue.SendRequest.push(flexError(1025, "Too many failed attempts."))
    await expect(pullIbkr()).rejects.toThrow("until tomorrow")
    later()
    await expect(pullIbkr()).rejects.toThrow(TooSoon)
    const allowed = Date.parse(getIbkrStatus().nextPullAllowedAt!)
    expect(allowed - now).toBeGreaterThan(60 * 60 * 1000)
    later(24 * 60 * 60 * 1000)
  })

  test("over MCP: status and pull now, errors in plain words", async () => {
    const tool = (name: string) => tools.find((t) => t.name === name)!
    const ctx = { actor: () => "mcp:test" as const }
    const text = (r: { content: unknown[] }) =>
      (r.content[0] as { text: string }).text
    const status = await callTool(tool("ibkr_status"), {}, ctx)
    const body = JSON.parse(text(status))
    expect(body).toMatchObject({ configured: true, tokenSet: true })
    expect(body.accounts[0].maskedId).toBe("U•••O001")
    expect(text(status)).not.toContain(FAKE_TOKEN)
    later()
    const pulled = await callTool(tool("ibkr_pull"), {}, ctx)
    expect(pulled.isError).toBeUndefined()
    const refused = await callTool(tool("ibkr_pull"), {}, ctx)
    expect(refused.isError).toBe(true)
    expect(text(refused)).toMatch(/one pull a minute/)
  })

  test("disconnect forgets the token but keeps the account and its history", async () => {
    const [account] = data.listAccounts()
    const status = disconnectIbkr("person")
    expect(status.configured).toBe(false)
    expect(status.token.set).toBe(false)
    expect(getSecret(TOKEN_KEY)).toBeUndefined()
    expect(data.getAccount(account.id).balance).toBe(9_537_002)
    expect(
      data.listTransactions({ accountId: account.id, limit: 500 }).total
    ).toBe(96)
    await expect(pullIbkr()).rejects.toThrow("Add your IBKR Flex token")
  })
})
