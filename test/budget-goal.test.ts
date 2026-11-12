// The monthly goal: one amount for the budget, none until set. A month's
// spending toward it is what the spending report counts (on-budget, net of
// refunds, never a move between own accounts) without categories outside the
// goal. A target only: the budget's numbers don't change.
import { beforeAll, describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"

useTempHome()

const MONTH = "2026-05"
let checking = 0
let savings = 0
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
    startingBalance: 1_000_000,
    startingDate: "2026-04-01",
  }).id
  savings = data.createAccount("person", {
    name: "Savings",
    type: "savings",
  }).id
  broker = data.createAccount("person", {
    name: "Broker",
    type: "investment",
    onBudget: false,
  }).id
  data.createTransactions("person", [
    {
      accountId: checking,
      date: `${MONTH}-01`,
      amount: 400_000,
      payeeName: "Northwind Ltd",
      categoryId: categoryId("Income"),
    },
    {
      accountId: checking,
      date: `${MONTH}-02`,
      amount: -150_000,
      payeeName: "Landlord",
      categoryId: categoryId("Rent"),
    },
    {
      accountId: checking,
      date: `${MONTH}-05`,
      amount: -20_000,
      payeeName: "Shoe shop",
      categoryId: categoryId("Shopping"),
    },
    // A refund lowers what was spent.
    {
      accountId: checking,
      date: `${MONTH}-09`,
      amount: 5_000,
      payeeName: "Shoe shop",
      categoryId: categoryId("Shopping"),
    },
    // Uncategorised spending counts, as in the spending report.
    {
      accountId: checking,
      date: `${MONTH}-10`,
      amount: -3_000,
      payeeName: "Kiosk",
    },
    // A move between own on-budget accounts is never spending.
    {
      accountId: checking,
      date: `${MONTH}-12`,
      amount: -100_000,
      transferAccountId: savings,
    },
    // Nor is a move to the broker, though the budget counts its category.
    {
      accountId: checking,
      date: `${MONTH}-15`,
      amount: -50_000,
      transferAccountId: broker,
      categoryId: categoryId("Holidays"),
    },
    // Next month's spending is next month's.
    {
      accountId: checking,
      date: "2026-06-01",
      amount: -7_000,
      payeeName: "Bistro",
      categoryId: categoryId("Dining out"),
    },
  ])
})

describe("monthly goal", () => {
  test("none until set: the month has no goal", () => {
    expect(data.getMonthlyGoal()).toBeNull()
    expect(data.getBudgetMonth(MONTH).goal).toBeNull()
  })

  test("counts spending net of refunds, without moves between own accounts", () => {
    data.setMonthlyGoal("person", 200_000)
    expect(data.getBudgetMonth(MONTH).goal).toEqual({
      amount: 200_000,
      // Rent 1,500 + shoes 200 − refund 50 + kiosk 30
      spent: 168_000,
      left: 32_000,
      planned: 0,
    })
    expect(data.getBudgetMonth("2026-06").goal?.spent).toBe(7_000)
    expect(data.listActivity({ limit: 1 }).items[0].summary).toBe(
      "Set the monthly goal to €2,000.00"
    )
  })

  test("a category outside the goal is left out of it and of the plan against it", () => {
    const rent = categoryId("Rent")
    data.setBudgetAmounts("person", MONTH, [
      { categoryId: rent, amount: 150_000 },
      { categoryId: categoryId("Shopping"), amount: 80_000 },
    ])
    expect(data.getBudgetMonth(MONTH).goal).toMatchObject({
      spent: 168_000,
      planned: 230_000,
    })
    const before = data.getBudgetMonth(MONTH)
    data.updateCategory("person", rent, { outsideGoal: true })
    expect(data.listActivity({ limit: 1 }).items[0].summary).toBe(
      "Left Rent out of the monthly goal"
    )
    const month = data.getBudgetMonth(MONTH)
    expect(month.goal).toEqual({
      amount: 200_000,
      spent: 18_000,
      left: 182_000,
      planned: 80_000,
    })
    // A target only: the budget's own numbers are the same.
    expect({ ...month, goal: null, groups: [] }).toEqual({
      ...before,
      goal: null,
      groups: [],
    })
    expect(
      data
        .listCategoryGroups()
        .flatMap((g) => g.categories)
        .find((c) => c.id === rent)?.outsideGoal
    ).toBe(true)
    data.updateCategory("person", rent, { outsideGoal: false })
  })

  test("over the goal, left is negative", () => {
    data.setMonthlyGoal("mcp:Claude", 100_000)
    expect(data.getBudgetMonth(MONTH).goal).toMatchObject({
      amount: 100_000,
      spent: 168_000,
      left: -68_000,
    })
  })

  test("removing it leaves no goal; a goal must be above zero", () => {
    expect(() => data.setMonthlyGoal("person", 0)).toThrow(/more than zero/)
    data.setMonthlyGoal("person", null)
    expect(data.getMonthlyGoal()).toBeNull()
    expect(data.getBudgetMonth(MONTH).goal).toBeNull()
    expect(data.listActivity({ limit: 1 }).items[0].summary).toBe(
      "Removed the monthly goal"
    )
  })
})
