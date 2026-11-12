import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { FlexQueryError, MissingSectionError } from "@/server/ibkr/errors"
import { flexDate, flexTimestamp, parseFlexReport } from "@/server/ibkr/flex"
import { parseXml } from "@/server/ibkr/xml"

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/ibkr/${name}`, import.meta.url), "utf8")
const full = fixture("flex-report.xml")
const [report] = parseFlexReport(full)
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0)

describe("the sample report", () => {
  test("reads the account, its base currency and the period", () => {
    expect(parseFlexReport(full)).toHaveLength(1)
    expect(report.accountId).toBe("UDEMO001")
    expect(report.currency).toBe("USD")
    expect(report.fromDate).toBe("2025-11-12")
    expect(report.toDate).toBe("2026-11-11")
    // 20261112;031544 US Eastern (EST, UTC−5)
    expect(report.generatedAt).toBe("2026-11-12T08:15:44.000Z")
    expect(report.missing).toEqual([])
  })

  test("one value per NAV row, the last one the NAV total", () => {
    expect(report.values).toHaveLength(262)
    expect(report.values[0]).toEqual({ date: "2025-11-11", value: 5_176_592 })
    expect(report.values.at(-1)).toEqual({
      date: "2026-11-11",
      value: 9_537_002,
    })
  })

  test("summary positions add up to NAV stock, with cost and P/L", () => {
    const positions = report.positions!
    expect(positions.map((p) => p.symbol).sort()).toEqual([
      "AAPL",
      "AMZN",
      "GOOGL",
      "MSFT",
      "NVDA",
      "V",
    ])
    expect(sum(positions.map((p) => p.value))).toBe(9_456_085)
    expect(positions.find((p) => p.symbol === "AAPL")).toEqual({
      symbol: "AAPL",
      name: "APPLE INC",
      assetClass: "stock",
      quantity: 64,
      price: 261.82,
      value: 1_675_648,
      costBasis: 1_346_012,
      unrealizedPnl: 329_636,
      currency: "USD",
      asOf: "2026-11-11",
    })
  })

  test("one cash row per currency, worth the base summary together", () => {
    const cash = report.cash!
    expect(cash).toEqual([
      expect.objectContaining({
        symbol: "EUR",
        name: "EUR cash",
        assetClass: "cash",
        quantity: 74.91,
        currency: "EUR",
        value: 79_099 - 70_597,
      }),
      expect.objectContaining({
        symbol: "USD",
        quantity: 705.97,
        currency: "USD",
        value: 70_597,
      }),
    ])
    // positions + cash + accruals (0.90 interest, 17.28 dividend) = NAV total
    const held = sum([...report.positions!, ...cash].map((h) => h.value))
    expect(held + 90 + 1728).toBe(9_537_002)
  })

  test("every trade and cash movement once, keyed by IBKR's transaction id", () => {
    expect(report.transactions).toHaveLength(22 + 73)
    const ids = report.transactions.map((t) => t.importedId)
    expect(new Set(ids).size).toBe(ids.length)
    const dates = report.transactions.map((t) => t.date)
    expect(dates).toEqual([...dates].sort())
  })

  test("EUR.USD trades are currency conversions, never stock trades", () => {
    const conversions = report.transactions.filter(
      (t) => t.payee === "Currency conversion"
    )
    expect(conversions).toHaveLength(13)
    expect(
      report.transactions.find((t) => t.importedId === "31877412386")
    ).toEqual({
      importedId: "31877412386",
      date: "2025-12-03",
      amount: -200,
      payee: "Currency conversion",
      notes: "€2,450.00 → US$2,802.87 · 1.14403 · fee US$2.00",
    })
    expect(report.transactions.some((t) => /EUR\.USD/.test(t.payee))).toBe(
      false
    )
  })

  test("stock trades in the account's currency and in another", () => {
    const byId = (id: string) =>
      report.transactions.find((t) => t.importedId === id)
    expect(byId("31877441412")).toMatchObject({
      date: "2026-08-12",
      payee: "Sold 20 NVDA",
      amount: 319_380,
      notes: "20 × US$159.74 · fee US$1.00",
    })
    // SAP in EUR: net cash 2,229.10 EUR at 1.11808 = 2,492.3121 USD
    expect(byId("31877446778")).toMatchObject({
      payee: "Sold 10 SAP",
      amount: 249_231,
      notes: "10 × €223.21 · fee €3.00 · €2,229.10 · 1.11808",
    })
    expect(
      report.transactions.filter((t) => t.payee.startsWith("Bought")).length
    ).toBeGreaterThan(0)
  })

  test("cash movements in the account's currency at the row's own rate", () => {
    const byId = (id: string) =>
      report.transactions.find((t) => t.importedId === id)
    expect(byId("31877412187")).toEqual({
      importedId: "31877412187",
      date: "2025-12-02",
      amount: 573_265,
      payee: "Deposit",
      notes: "€5,000.00 · 1.14653",
    })
    expect(byId("31877410742")).toMatchObject({
      payee: "AAPL dividend",
      amount: 1040,
    })
    expect(byId("31877410786")).toMatchObject({
      payee: "AAPL withholding tax",
      amount: -156,
    })
    expect(byId("31877413142")).toMatchObject({
      payee: "Interest",
      amount: 184,
    })
    expect(byId("31877414071")).toMatchObject({ payee: "Fees", amount: -150 })
    // the withdrawal's description names the holder; it is dropped
    expect(byId("31877434285")).toMatchObject({
      payee: "Withdrawal",
      amount: -139_852,
      notes: "−€1,200.00 · 1.16543",
    })
  })

  test("keeps nothing personal from Account Information", () => {
    const text = JSON.stringify(parseFlexReport(full))
    for (const personal of [
      "Example Person",
      "person@example.org",
      "Example Street",
      "Amsterdam",
      "1000 AA",
      "19880412",
    ])
      expect(text).not.toContain(personal)
  })
})

describe("query variations", () => {
  test("lists missing sections and keeps going", () => {
    const [r] = parseFlexReport(fixture("flex-report-missing.xml"))
    expect(r.missing).toEqual(["Cash Report", "Open Positions", "Trades"])
    expect(r.positions).toBeNull()
    expect(r.cash).toBeNull()
    expect(r.transactions).toHaveLength(73)
    expect(r.values.at(-1)?.value).toBe(9_537_002)
  })

  test("fails without NAV in Base, naming the section to tick", () => {
    const xml = full.replace(
      /<EquitySummaryInBase>[\s\S]*<\/EquitySummaryInBase>\n/,
      ""
    )
    expect(() => parseFlexReport(xml)).toThrow(MissingSectionError)
    expect(() => parseFlexReport(xml)).toThrow(
      "tick Net Asset Value (NAV) in Base"
    )
  })

  test("empty sections are fine", () => {
    const xml = full
      .replace(/<Trades>[\s\S]*<\/Trades>/, "<Trades />")
      .replace(/<OpenPositions>[\s\S]*<\/OpenPositions>/, "<OpenPositions />")
    const [r] = parseFlexReport(xml)
    expect(r.missing).toEqual([])
    expect(r.positions).toEqual([])
    expect(r.transactions).toHaveLength(73)
  })

  test("lot rows never double-count; lots alone are added up", () => {
    const aapl = /<OpenPosition [^>]*symbol="AAPL"[^>]*\/>/.exec(full)![0]
    const lot = (qty: string, value: string) =>
      aapl
        .replace('levelOfDetail="SUMMARY"', 'levelOfDetail="LOT"')
        .replace('position="64"', `position="${qty}"`)
        .replace('positionValue="16756.48"', `positionValue="${value}"`)
    const lots = lot("40", "10472.80") + "\n" + lot("24", "6283.68")
    const withLots = full.replace(aapl, aapl + "\n" + lots)
    const [r] = parseFlexReport(withLots)
    expect(r.positions).toHaveLength(6)
    expect(sum(r.positions!.map((p) => p.value))).toBe(9_456_085)

    const onlyLots = full.replace(
      /<OpenPositions>[\s\S]*<\/OpenPositions>/,
      `<OpenPositions>\n${lots}\n</OpenPositions>`
    )
    const [l] = parseFlexReport(onlyLots)
    expect(l.positions).toEqual([
      expect.objectContaining({
        symbol: "AAPL",
        quantity: 64,
        value: 1_675_648,
      }),
    ])
  })

  test("a report for several accounts gives one entry each", () => {
    const statement = /<FlexStatement [\s\S]*<\/FlexStatement>/.exec(full)![0]
    const xml = full
      .replace('count="1"', 'count="2"')
      .replace(
        statement,
        statement + "\n" + statement.replaceAll("UDEMO001", "UDEMO002")
      )
    expect(parseFlexReport(xml).map((r) => r.accountId)).toEqual([
      "UDEMO001",
      "UDEMO002",
    ])
  })

  test("dates as yyyyMMdd or yyyy-MM-dd; anything else asks for yyyyMMdd", () => {
    expect(flexDate("20261111")).toBe("2026-11-11")
    expect(flexDate("20261111;093441")).toBe("2026-11-11")
    expect(flexDate("2026-11-11")).toBe("2026-11-11")
    expect(flexDate("2026-11-11 09:34:41")).toBe("2026-11-11")
    expect(() => flexDate("11/11/2026")).toThrow(FlexQueryError)
    expect(() => flexDate("11/11/2026")).toThrow("yyyyMMdd")
    const xml = full.replace(
      /reportDate="(\d{4})(\d{2})(\d{2})"/g,
      'reportDate="$2/$3/$1"'
    )
    expect(() => parseFlexReport(xml)).toThrow("Date Format to yyyyMMdd")
    // summer time: EDT is UTC−4
    expect(flexTimestamp("20260701;120000")).toBe("2026-07-01T16:00:00.000Z")
  })

  test("refuses what isn't a Flex report", () => {
    expect(() => parseFlexReport("<html><body>hi</body></html>")).toThrow(
      FlexQueryError
    )
    expect(() => parseFlexReport("FlexQueryResponse,a,b")).toThrow(
      "isn't readable XML"
    )
  })
})

describe("the XML reader", () => {
  test("elements, attributes, entities and text", () => {
    const el = parseXml(
      `<?xml version="1.0"?><!-- c --><A x="1 &amp; 2" y='&quot;'><B/><C>hi &lt;3</C></A>`
    )
    expect(el.attrs).toEqual({ x: "1 & 2", y: '"' })
    expect(el.children.map((c) => c.name)).toEqual(["B", "C"])
    expect(el.children[1].text).toBe("hi <3")
  })

  test("is strict about malformed input", () => {
    for (const bad of [
      "<A>",
      "<A></B>",
      "<A x=1/>",
      "<A/><B/>",
      "",
      "<A &x;/>",
    ])
      expect(() => parseXml(bad)).toThrow()
  })
})
