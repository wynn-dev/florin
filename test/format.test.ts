import { afterEach, describe, expect, test } from "vitest"
import {
  addDays,
  localiseAmounts,
  addMonths,
  currencyDigits,
  currencySymbol,
  currentMonth,
  formatAmountInput,
  formatDate,
  formatDayHeading,
  formatMoney,
  formatMonth,
  formatMonthTick,
  formatPercent,
  formatQuantity,
  formatRelative,
  lastDay,
  parseAmount,
  setLocale,
} from "@/lib/format"

afterEach(() => setLocale("en-GB"))

describe("formatMoney", () => {
  test("uses a true minus for negative amounts", () => {
    expect(formatMoney(-4210, "EUR")).toBe("−€42.10")
    expect(formatMoney(-4210, "EUR")).not.toContain("-")
  })

  test("groups thousands and keeps two decimals", () => {
    expect(formatMoney(123456789, "EUR")).toBe("€1,234,567.89")
    expect(formatMoney(0, "EUR")).toBe("€0.00")
  })

  test("signed shows + for inflows and − for outflows, nothing for zero", () => {
    expect(formatMoney(120000, "EUR", { signed: true })).toBe("+€1,200.00")
    expect(formatMoney(-4210, "EUR", { signed: true })).toBe("−€42.10")
    expect(formatMoney(0, "EUR", { signed: true })).toBe("€0.00")
  })

  test("whole rounds to whole units", () => {
    expect(formatMoney(4814049, "EUR", { whole: true })).toBe("€48,140")
    expect(formatMoney(-4814050, "EUR", { whole: true })).toBe("−€48,141")
  })

  test("drops the symbol for single-currency columns", () => {
    expect(formatMoney(-4210, "EUR", { symbol: false })).toBe("−42.10")
    expect(formatMoney(120000, "USD", { symbol: false, signed: true })).toBe(
      "+1,200.00"
    )
  })

  test("marks US dollars as US$ outside the US", () => {
    expect(formatMoney(5231024, "USD")).toBe("US$52,310.24")
    expect(currencySymbol("USD")).toBe("US$")
    expect(currencySymbol("EUR")).toBe("€")
  })

  test("uses the currency's own decimals: JPY has none", () => {
    expect(currencyDigits("JPY")).toBe(0)
    expect(formatMoney(1200, "JPY")).toBe("JP¥1,200")
    expect(formatMoney(-1200, "JPY", { symbol: false })).toBe("−1,200")
  })

  test("compact for axis ticks", () => {
    expect(formatMoney(8_000_000, "EUR", { compact: true })).toBe("€80k")
    expect(formatMoney(-1_250_000, "EUR", { compact: true })).toBe("−€12.5k")
    expect(formatMoney(50_000, "EUR", { compact: true })).toBe("€500")
  })

  test("follows the locale", () => {
    setLocale("de-DE")
    expect(formatMoney(-120050, "EUR")).toBe("−1.200,50 €")
  })
})

describe("amount input", () => {
  test("parses plain numbers into minor units", () => {
    expect(parseAmount("42.1", "EUR")).toBe(4210)
    expect(parseAmount("1,200.50", "EUR")).toBe(120050)
    expect(parseAmount("1,200", "EUR")).toBe(120000)
    expect(parseAmount("12,50", "EUR")).toBe(1250)
    expect(parseAmount(" 7 ", "EUR")).toBe(700)
    expect(parseAmount(".5", "EUR")).toBe(50)
  })

  test("rejects what isn't a plain number", () => {
    expect(parseAmount("", "EUR")).toBeNull()
    expect(parseAmount("-12", "EUR")).toBeNull()
    expect(parseAmount("12+8", "EUR")).toBeNull()
    expect(parseAmount("1.2.3", "EUR")).toBeNull()
    expect(parseAmount("4.125", "EUR")).toBeNull()
    expect(parseAmount("12.5", "JPY")).toBeNull()
  })

  test("JPY reads whole yen", () => {
    expect(parseAmount("1200", "JPY")).toBe(1200)
    expect(parseAmount("1,200", "JPY")).toBe(1200)
    expect(formatAmountInput(-1200, "JPY")).toBe("1200")
  })

  test("uses the locale's decimal comma", () => {
    setLocale("de-DE")
    expect(parseAmount("1.200,5", "EUR")).toBe(120050)
    expect(parseAmount("1.200", "EUR")).toBe(120000)
    expect(parseAmount("12.5", "EUR")).toBe(1250)
    expect(formatAmountInput(4210, "EUR")).toBe("42,10")
  })

  test("formats for editing without sign or grouping", () => {
    expect(formatAmountInput(-123456, "EUR")).toBe("1234.56")
  })
})

describe("dates", () => {
  const now = new Date(2026, 10, 12, 14, 30)

  test("rows show the year only outside the current year", () => {
    expect(formatDate("2026-11-12", now)).toBe("12 Nov")
    expect(formatDate("2025-12-31", now)).toBe("31 Dec 2025")
    expect(formatDate("2026-01-01", new Date(2026, 0, 1))).toBe("1 Jan")
  })

  test("day headings", () => {
    expect(formatDayHeading("2026-11-12", now)).toBe("Today")
    expect(formatDayHeading("2026-11-11", now)).toBe("Yesterday")
    expect(formatDayHeading("2026-11-10", now)).toBe("Tue 10 Nov")
    expect(formatDayHeading("2025-11-10", now)).toBe("Mon 10 Nov 2025")
  })

  test("month headers and axis ticks", () => {
    expect(formatMonth("2026-11")).toBe("November 2026")
    expect(formatMonthTick("2026-11")).toBe("Nov")
    expect(formatMonthTick("2026-01-15")).toBe("Jan 2026")
    expect(formatMonthTick("2026-03", true)).toBe("Mar 2026")
  })

  test("month arithmetic rolls over years", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01")
    expect(addMonths("2026-01", -1)).toBe("2025-12")
    expect(addMonths("2026-12", 1)).toBe("2027-01")
    expect(addMonths("2026-03", -15)).toBe("2024-12")
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(lastDay("2028-02")).toBe("2028-02-29")
    expect(lastDay("2026-12")).toBe("2026-12-31")
    expect(currentMonth(new Date(2026, 11, 31, 23, 59))).toBe("2026-12")
  })

  test("relative time", () => {
    const at = (ms: number) => new Date(now.getTime() - ms).toISOString()
    expect(formatRelative(at(10_000), now)).toBe("just now")
    expect(formatRelative(at(12 * 60_000), now)).toBe("12 min ago")
    expect(formatRelative(at(2 * 3_600_000), now)).toBe("2 hr ago")
    expect(formatRelative(at(20 * 3_600_000), now)).toBe("yesterday")
    expect(formatRelative(at(3 * 86_400_000), now)).toBe("3 days ago")
    expect(
      formatRelative(
        new Date(now.getTime() + 5 * 86_400_000).toISOString(),
        now
      )
    ).toBe("in 5 days")
    expect(formatRelative(at(30 * 86_400_000), now)).toBe("13 Oct")
  })
})

test("formatQuantity", () => {
  expect(formatQuantity(1204.5)).toBe("1,204.5")
  expect(formatQuantity(12.123456)).toBe("12.1235")
  expect(formatQuantity(-3)).toBe("−3")
})

test("formatPercent", () => {
  expect(formatPercent(0.456)).toBe("46%")
  expect(formatPercent(-0.03, { signed: true })).toBe("−3%")
  expect(formatPercent(0.12, { signed: true })).toBe("+12%")
})

describe("amounts in server-written text", () => {
  test("follow the locale", () => {
    setLocale("de-DE")
    expect(localiseAmounts("Moved €1,234.50 from A to B")).toMatch(
      /^Moved 1\.234,50\s€ from A to B$/
    )
    expect(localiseAmounts("Budgeted CHF 40.00 for Food")).toMatch(
      /^Budgeted 40,00\sCHF for Food$/
    )
    expect(localiseAmounts("Added −$12.00 at Shop")).toMatch(
      /^Added −12,00\s\$ at Shop$/
    )
    setLocale("en-GB")
    expect(localiseAmounts("Added −$12.00 at Shop")).toBe(
      "Added −US$12.00 at Shop"
    )
    expect(localiseAmounts("Paid ¥1,235 on 2026-11-02")).toBe(
      "Paid JP¥1,235 on 2026-11-02"
    )
  })
})
