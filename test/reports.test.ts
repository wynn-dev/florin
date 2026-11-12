import { beforeAll, describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"
import { seedDemo } from "@/server/seed"
import { addMonths, monthEnd, today } from "@/server/data/validate"

useTempHome()

let accountId: (name: string) => number
beforeAll(() => {
  seedDemo()
  const accounts = data.listAccounts()
  accountId = (name) => accounts.find((a) => a.name === name)!.id
})

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

describe("net worth report", () => {
  test("month ends over the last twelve months, ending today, with the accounts adding up", () => {
    const report = data.netWorthReport()
    expect(report.step).toBe("month")
    expect(report.points).toHaveLength(12)
    expect(report.points.at(-1)!.date).toBe(today())
    expect(report.points[0].date).toBe(monthEnd(report.from.slice(0, 7)))
    expect(report.missingRates).toBe(false)
    for (const p of report.points)
      expect(p.netWorth).toBe(p.assets - p.liabilities)

    const last = report.points.at(-1)!
    expect(sum(report.accounts.map((a) => a.end!))).toBe(last.netWorth)
    for (const a of report.accounts) expect(a.change).toBe(a.end! - a.start!)
    expect(report.accounts.map((a) => [a.name, a.group])).toEqual([
      ["Current account", "cash"],
      ["Savings", "cash"],
      ["Credit card", "credit"],
      ["Cash", "cash"],
      ["Brokerage", "investments"],
    ])
  })

  test("an account in another currency converts at each date's rate and says how", () => {
    const brokerage = data.netWorthReport({
      accountIds: [accountId("Brokerage")],
    }).accounts[0]
    expect(brokerage.currency).toBe("USD")
    const end = brokerage.endConversion!
    expect(end.amount).toBe(
      data.listAccounts().find((a) => a.name === "Brokerage")!.balance
    )
    expect(end.rate).toBeCloseTo(1 / data.rateOn("USD", today())!, 10)
    expect(end.rateDate <= today()).toBe(true)
    expect(brokerage.end).toBe(Math.round(end.amount * end.rate))
    expect(
      data.netWorthReport({ accountIds: [accountId("Savings")] }).accounts[0]
        .endConversion
    ).toBeNull()
  })

  test("days for three months or less, weeks on request, all time from the first data", () => {
    const from = addMonths(today().slice(0, 7), -2) + "-01"
    const days = data.netWorthReport({ from })
    expect(days.step).toBe("day")
    expect(days.points[0].date).toBe(from)
    expect(days.points.at(-1)!.date).toBe(today())

    const weeks = data.netWorthReport({ step: "week" })
    expect(weeks.points.at(-1)!.date).toBe(today())
    expect(weeks.points.length).toBeGreaterThanOrEqual(48)

    const all = data.netWorthReport({ all: true })
    expect(all.from).toBe(all.dataFrom)
    expect(all.points).toHaveLength(18)
    // Before the first transaction there is nothing.
    expect(all.accounts.every((a) => a.start === 0)).toBe(true)
  })
})

describe("spending report", () => {
  test("groups add up, and match the expenses of income and expenses", () => {
    const report = data.spendingReport()
    expect(report.months).toBe(12)
    expect(report.total).toBe(sum(report.groups.map((g) => g.amount)))
    for (const g of report.groups) {
      expect(g.amount).toBe(sum(g.categories.map((c) => c.amount)))
      expect(g.categories.map((c) => c.amount)).toEqual(
        [...g.categories.map((c) => c.amount)].sort((a, b) => b - a)
      )
    }
    expect(report.groups.map((g) => g.amount)).toEqual(
      [...report.groups.map((g) => g.amount)].sort((a, b) => b - a)
    )
    const expenses = sum(
      data.incomeExpenseReport().months.map((m) => m.expenses)
    )
    expect(report.total).toBe(expenses)
    // Transfers between on-budget accounts (to savings, paying the card) aren't
    // spending: Uncategorised is only the demo's few uncategorised purchases.
    const names = report.groups.flatMap((g) => g.categories.map((c) => c.name))
    expect(names).toContain("Rent")
    const uncategorised = data.listTransactions({
      uncategorized: true,
      from: report.from,
      to: report.to,
      limit: 1000,
    })
    expect(uncategorised.total).toBeGreaterThan(0)
    expect(report.groups.find((g) => g.name === "Uncategorised")?.amount).toBe(
      -sum(uncategorised.items.map((t) => t.amount))
    )
  })

  test("the previous period is the same stretch, as many months earlier", () => {
    const from = addMonths(today().slice(0, 7), -5) + "-01"
    const to = monthEnd(addMonths(today().slice(0, 7), -1))
    const report = data.spendingReport({ from, to })
    expect(report.months).toBe(5)
    expect(report.previousFrom).toBe(addMonths(from.slice(0, 7), -5) + "-01")
    expect(report.previousTo).toBe(monthEnd(addMonths(to.slice(0, 7), -5)))
    const before = data.spendingReport({
      from: report.previousFrom,
      to: report.previousTo,
    })
    expect(report.previousTotal).toBe(before.total)
    const rent = (r: typeof report) =>
      r.groups.flatMap((g) => g.categories).find((c) => c.name === "Rent")!
    expect(rent(report)).toMatchObject({ amount: 625_000, previous: 625_000 })
  })
})

describe("income and expenses report", () => {
  test("net and savings rate per month", () => {
    const report = data.incomeExpenseReport()
    expect(report.months).toHaveLength(12)
    for (const m of report.months) {
      expect(m.net).toBe(m.income - m.expenses)
      if (m.income) expect(m.savingsRate).toBeCloseTo(m.net / m.income)
      else expect(m.savingsRate).toBeNull()
    }
    expect(
      report.months.filter((m) => m.income > 0).length
    ).toBeGreaterThanOrEqual(11)
  })
})

describe("cash flow report", () => {
  test("balances chain from month to month and flows explain them", () => {
    const report = data.cashFlowReport()
    expect(report.months).toHaveLength(12)
    report.months.forEach((m, i) => {
      expect(m.net).toBe(m.inflow - m.outflow + m.transfers)
      expect(m.ending).toBe(m.starting + m.net)
      if (i) expect(m.starting).toBe(report.months[i - 1].ending)
    })
    const cash = data
      .listAccounts()
      .filter((a) => ["Current account", "Savings", "Cash"].includes(a.name))
    expect(report.months.at(-1)!.ending).toBe(sum(cash.map((a) => a.balance)))
  })

  test("paying the card is a transfer, not money out; moving to savings is neither", () => {
    const month = addMonths(today().slice(0, 7), -1)
    const range = { from: month + "-01", to: monthEnd(month) }
    const current = data.cashFlowReport({
      ...range,
      accountIds: [accountId("Current account")],
    }).months[0]
    const both = data.cashFlowReport({
      ...range,
      accountIds: [accountId("Current account"), accountId("Savings")],
    }).months[0]
    // The 300.00 to savings leaves the current account but stays in cash.
    expect(current.outflow).toBe(both.outflow)
    expect(both.transfers - current.transfers).toBe(30_000)
    const card = data.listTransactions({
      accountId: accountId("Credit card"),
      ...range,
    })
    const payment = card.items.find(
      (t) => t.transferAccountId === accountId("Current account")
    )!
    expect(payment.amount).toBeGreaterThan(0)
    expect(both.transfers).toBeLessThanOrEqual(-payment.amount)
  })

  test("the old summary agrees with the report", () => {
    const report = data.cashFlowReport()
    expect(data.cashFlow()).toEqual(
      report.months.map(({ month, inflow, outflow, transfers, net }) => ({
        month,
        inflow,
        outflow,
        transfers,
        net,
      }))
    )
  })
})

describe("spending by day", () => {
  test("cumulative to today, against all of last month", () => {
    const { current, previous } = data.spendingByDay()
    expect(current.days).toHaveLength(Number(today().slice(8, 10)))
    expect(previous.days).toHaveLength(
      Number(monthEnd(previous.month).slice(8))
    )
    const month = data.incomeExpenseReport({ from: previous.month + "-01" })
    expect(previous.days.at(-1)).toBe(month.months[0].expenses)
    expect(current.days.at(-1)).toBe(month.months[1].expenses)
  })
})

describe("the demo", () => {
  test("has a move to savings to link and last month's overspending", () => {
    const last = addMonths(today().slice(0, 7), -1)
    const [pair, ...rest] = data.suggestTransfers()
    expect(rest).toEqual([])
    expect(pair).toMatchObject({
      out: { accountName: "Current account", amount: -50_000 },
      into: { accountName: "Savings", amount: 50_000 },
      days: 1,
    })
    const shopping = (month: string) =>
      data
        .getBudgetMonth(month)
        .groups.flatMap((g) => g.categories)
        .find((c) => c.name === "Shopping")!
    expect(shopping(last).available).toBe(-6_490)
    expect(shopping(today().slice(0, 7)).available).toBeGreaterThanOrEqual(0)
    expect(
      data.getBudgetMonth(today().slice(0, 7)).lastMonthOverspent
    ).toBeGreaterThanOrEqual(6_490)
  })
})

describe("report queries", () => {
  test("parses the URL's parameters and refuses bad ones", () => {
    expect(
      data.reportQuery({
        from: "2026-01-01",
        all: "true",
        accounts: "1,2",
        step: "week",
      })
    ).toEqual({
      from: "2026-01-01",
      to: undefined,
      all: true,
      accountIds: [1, 2],
      step: "week",
    })
    expect(() => data.reportQuery({ accounts: "x" })).toThrow(data.InvalidInput)
    expect(() => data.reportQuery({ step: "year" })).toThrow(data.InvalidInput)
    expect(() =>
      data.spendingReport({ from: "2026-02-01", to: "2026-01-01" })
    ).toThrow(data.InvalidInput)
  })
})
