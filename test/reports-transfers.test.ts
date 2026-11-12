// Moving money between the person's own accounts is never spending or
// income in Overview and Reports, whichever accounts; the budget still counts
// a categorised transfer to an off-budget account in its category. Net worth
// starts where the data starts when that is less than a year ago.
import { beforeAll, describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"
import { addMonths, today } from "@/server/data/validate"

useTempHome()

const month = addMonths(today().slice(0, 7), -1)
const start = addMonths(month, -2) + "-05"
let checking = 0
let broker = 0

function categoryId(name: string): number {
  for (const g of data.listCategoryGroups()) {
    const c = g.categories.find((x) => x.name === name)
    if (c) return c.id
  }
  throw new Error(`no category ${name}`)
}

beforeAll(() => {
  checking = data.createAccount("person", {
    name: "Day to day",
    type: "checking",
    startingBalance: 2_000_000,
    startingDate: start,
  }).id
  broker = data.createAccount("person", {
    name: "Broker",
    type: "investment",
    onBudget: false,
  }).id
  data.createTransactions("person", [
    {
      accountId: checking,
      date: `${month}-03`,
      amount: 300_000,
      payeeName: "Northwind Ltd",
      categoryId: categoryId("Income"),
    },
    {
      accountId: checking,
      date: `${month}-04`,
      amount: -4_500,
      payeeName: "Corner market",
      categoryId: categoryId("Groceries"),
    },
    // Investing, categorised in the budget as a goal.
    {
      accountId: checking,
      date: `${month}-10`,
      amount: -1_000_000,
      transferAccountId: broker,
      categoryId: categoryId("Emergency fund"),
    },
    // Money coming back, uncategorised.
    {
      accountId: checking,
      date: `${month}-20`,
      amount: 200_000,
      transferAccountId: broker,
    },
  ])
})

describe("transfers to an off-budget account", () => {
  test("are neither spending nor income in any report", () => {
    const range = { from: `${month}-01`, to: `${month}-28` }
    expect(data.spendingReport(range).total).toBe(4_500)
    expect(data.spendingByCategory(range)).toEqual([
      expect.objectContaining({ categoryName: "Groceries", amount: 4_500 }),
    ])
    expect(data.incomeExpenseReport(range).months[0]).toMatchObject({
      income: 300_000,
      expenses: 4_500,
    })
    expect(data.incomeVsExpenses(range)).toEqual([
      { month, income: 300_000, expenses: 4_500 },
    ])
    expect(data.spendingByDay(month).current.days.at(-1)).toBe(4_500)
  })

  test("show in cash flow as transfers, keeping the balances whole", () => {
    const flow = data.cashFlowReport({ from: `${month}-01` }).months[0]
    expect(flow).toMatchObject({
      inflow: 300_000,
      outflow: 4_500,
      transfers: -800_000,
      net: -504_500,
    })
    expect(flow.ending - flow.starting).toBe(flow.net)
  })

  test("still count in their budget category", () => {
    const budget = data.getBudgetMonth(month)
    const fund = budget.groups
      .flatMap((g) => g.categories)
      .find((c) => c.name === "Emergency fund")!
    expect(fund.activity).toBe(-1_000_000)
  })
})

describe("net worth", () => {
  test("starts at the first date with data when that is less than a year ago", () => {
    const report = data.netWorthReport({ step: "week" })
    expect(report.from).toBe(start)
    expect(report.points[0].date).toBe(start)
    expect(report.points[0].netWorth).toBe(2_000_000)
    expect(data.netWorthReport().points[0].netWorth).toBe(2_000_000)
    expect(data.netWorthRange()).toEqual({ from: start, to: today() })
    expect(data.netWorth()[0].netWorth).toBe(2_000_000)
  })

  test("keeps a range that is asked for", () => {
    const from = addMonths(today().slice(0, 7), -11) + "-01"
    expect(data.netWorthReport({ from }).from).toBe(from)
    expect(data.netWorthRange({ from }).from).toBe(from)
  })
})
