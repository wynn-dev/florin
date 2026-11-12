// The data layer's bulk and agent-facing additions: per-transaction patches,
// moving money between envelopes, deleting categories with reassignment,
// amount filters, uncategorized meaning on budget, and listing rates.
import { describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"

useTempHome()

const MONTH = "2026-03"

function categoryId(name: string): number {
  for (const g of data.listCategoryGroups()) {
    const c = g.categories.find((x) => x.name === name)
    if (c) return c.id
  }
  throw new Error(`no category ${name}`)
}

function category(month: string, id: number) {
  return data
    .getBudgetMonth(month)
    .groups.flatMap((g) => g.categories)
    .find((c) => c.id === id)!
}

function setup() {
  const account = data.createAccount("person", {
    name: `Checking ${Math.random()}`,
    type: "checking",
    startingBalance: 100_000,
    startingDate: `${MONTH}-01`,
  })
  const [a, b, c] = data.createTransactions("person", [
    {
      accountId: account.id,
      date: `${MONTH}-02`,
      amount: -1_000,
      payeeName: "A",
    },
    {
      accountId: account.id,
      date: `${MONTH}-03`,
      amount: -2_500,
      payeeName: "B",
    },
    {
      accountId: account.id,
      date: `${MONTH}-04`,
      amount: 4_000,
      payeeName: "C",
    },
  ])
  return { account, a, b, c }
}

describe("patchTransactions", () => {
  test("gives each transaction its own change", () => {
    const { a, b } = setup()
    const [x, y] = data.patchTransactions("mcp:test", [
      { id: a.id, categoryId: categoryId("Groceries") },
      { id: b.id, categoryId: categoryId("Dining out"), payeeName: "Bistro" },
    ])
    expect(x.categoryName).toBe("Groceries")
    expect(y).toMatchObject({ categoryName: "Dining out", payeeName: "Bistro" })
  })

  test("changes nothing when one item fails, and names it", () => {
    const { a, b } = setup()
    expect(() =>
      data.patchTransactions("mcp:test", [
        { id: a.id, notes: "first" },
        { id: b.id, date: "March 3rd" },
      ])
    ).toThrow("item 2 of 2: date must be a date as YYYY-MM-DD")
    expect(data.getTransaction(a.id).notes).toBe("")
  })
})

describe("transaction filters", () => {
  test("amount bounds are inclusive and signed", () => {
    const { account } = setup()
    const spent = data.listTransactions({
      accountId: account.id,
      minAmount: -2_500,
      maxAmount: -1,
    })
    expect(spent.items.map((t) => t.amount).sort()).toEqual([-1_000, -2_500])
    expect(spent.total).toBe(2)
  })

  test("uncategorized leaves out tracking accounts", () => {
    const tracking = data.createAccount("person", {
      name: "Old savings",
      type: "savings",
      onBudget: false,
    })
    data.createTransaction("person", {
      accountId: tracking.id,
      date: `${MONTH}-05`,
      amount: 500,
    })
    const { items, total } = data.listTransactions({ uncategorized: true })
    expect(items.some((t) => t.accountId === tracking.id)).toBe(false)
    expect(total).toBe(items.length)
  })
})

describe("moveBudgetAmounts", () => {
  test("moves assigned money without changing to budget", () => {
    const groceries = categoryId("Groceries")
    const holidays = categoryId("Holidays")
    data.setBudgetAmounts("person", MONTH, [
      { categoryId: groceries, amount: 30_000 },
    ])
    const before = data.getBudgetMonth(MONTH).toBudget
    const after = data.moveBudgetAmounts("mcp:test", MONTH, [
      { fromCategoryId: groceries, toCategoryId: holidays, amount: 5_000 },
    ])
    expect(after.toBudget).toBe(before)
    expect(category(MONTH, groceries).budgeted).toBe(25_000)
    expect(category(MONTH, holidays).budgeted).toBe(5_000)
    expect(data.listActivity({ limit: 1 }).items[0].summary).toBe(
      "Moved €50.00 from Groceries to Holidays in 2026-03"
    )
  })

  test("refuses income categories, the same category and non-positive amounts", () => {
    const groceries = categoryId("Groceries")
    const move = (to: number, amount: number) =>
      data.moveBudgetAmounts("person", MONTH, [
        { fromCategoryId: groceries, toCategoryId: to, amount },
      ])
    expect(() => move(categoryId("Income"), 100)).toThrow(/income category/)
    expect(() => move(groceries, 100)).toThrow(/two different/)
    expect(() => move(categoryId("Rent"), -100)).toThrow(/positive/)
  })
})

describe("deleting categories with reassignment", () => {
  test("a category's transactions and budgets move, so its money stays available", () => {
    const { a } = setup()
    const group = data.createCategoryGroup("person", { name: "Temporary" })
    const old = data.createCategory("person", {
      groupId: group.id,
      name: "Old",
    })
    const keep = categoryId("Shopping")
    data.updateTransaction("person", a.id, { categoryId: old.id })
    data.setBudgetAmounts("person", MONTH, [
      { categoryId: old.id, amount: 3_000 },
      { categoryId: keep, amount: 1_000 },
    ])
    const before = data.getBudgetMonth(MONTH).toBudget
    const keepBefore = category(MONTH, keep).available
    data.deleteCategory("person", old.id, keep)
    expect(data.getTransaction(a.id).categoryId).toBe(keep)
    expect(category(MONTH, keep)).toMatchObject({
      budgeted: 4_000,
      available: keepBefore + 3_000 - 1_000,
    })
    expect(data.getBudgetMonth(MONTH).toBudget).toBe(before)
  })

  test("a whole group can hand its categories' data to one category", () => {
    const { b } = setup()
    const group = data.createCategoryGroup("person", { name: "Going away" })
    const one = data.createCategory("person", {
      groupId: group.id,
      name: "One",
    })
    const two = data.createCategory("person", {
      groupId: group.id,
      name: "Two",
    })
    data.updateTransaction("person", b.id, { categoryId: two.id })
    data.setBudgetAmounts("person", MONTH, [
      { categoryId: one.id, amount: 700 },
    ])
    const target = categoryId("Phone & internet")
    expect(() => data.deleteCategoryGroup("person", group.id, one.id)).toThrow(
      /in the group being deleted/
    )
    data.deleteCategoryGroup("person", group.id, target)
    expect(data.getTransaction(b.id).categoryId).toBe(target)
    expect(category(MONTH, target).budgeted).toBe(700)
    expect(data.listCategoryGroups().some((g) => g.id === group.id)).toBe(false)
  })
})

describe("listFxRates", () => {
  test("latest per currency, or one currency's history", () => {
    data.saveFxRates("person", [
      { date: "2026-03-02", currency: "USD", rate: 1.08 },
      { date: "2026-03-03", currency: "USD", rate: 1.09 },
      { date: "2026-03-02", currency: "GBP", rate: 0.85 },
    ])
    expect(data.listFxRates()).toEqual([
      { date: "2026-03-03", currency: "USD", rate: 1.09 },
      { date: "2026-03-02", currency: "GBP", rate: 0.85 },
    ])
    expect(
      data
        .listFxRates({ currency: "USD", from: "2026-03-01" })
        .map((r) => r.rate)
    ).toEqual([1.09, 1.08])
  })
})
