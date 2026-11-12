// The budget page's data: moving money to and from what is not planned yet, a
// category's inspector numbers, and the first month with money in it.
import { describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"

useTempHome()

function categoryId(name: string): number {
  for (const g of data.listCategoryGroups()) {
    const c = g.categories.find((x) => x.name === name)
    if (c) return c.id
  }
  throw new Error(`no category ${name}`)
}

function budgeted(month: string, id: number): number {
  return data
    .getBudgetMonth(month)
    .groups.flatMap((g) => g.categories)
    .find((c) => c.id === id)!.budgeted
}

describe("budget page", () => {
  test("firstMonth is null until an on-budget account has a transaction", () => {
    expect(data.getBudgetMonth("2026-05").firstMonth).toBeNull()
    data.createAccount("person", {
      name: "Brokerage",
      type: "investment",
      startingBalance: 50_000,
      startingDate: "2024-01-10",
    })
    expect(data.getBudgetMonth("2026-05").firstMonth).toBeNull()
    const account = data.createAccount("person", {
      name: "Checking",
      type: "checking",
      startingBalance: 200_000,
      startingDate: "2026-03-04",
    })
    expect(data.getBudgetMonth("2026-05").firstMonth).toBe("2026-03")
    data.createTransaction("person", {
      accountId: account.id,
      date: "2026-04-02",
      amount: -4_210,
      categoryId: categoryId("Groceries"),
    })
  })

  test("moves money from and back to what is not planned yet", () => {
    const groceries = categoryId("Groceries")
    const before = data.getBudgetMonth("2026-04").toBudget
    let month = data.moveBudgetAmounts("person", "2026-04", [
      { fromCategoryId: null, toCategoryId: groceries, amount: 30_000 },
    ])
    expect(month.toBudget).toBe(before - 30_000)
    expect(budgeted("2026-04", groceries)).toBe(30_000)
    expect(data.listActivity({ limit: 1 }).items[0].summary).toBe(
      "Planned €300.00 more for Groceries in 2026-04"
    )
    month = data.moveBudgetAmounts("person", "2026-04", [
      { fromCategoryId: groceries, toCategoryId: null, amount: 10_000 },
    ])
    expect(month.toBudget).toBe(before - 20_000)
    expect(budgeted("2026-04", groceries)).toBe(20_000)
    expect(() =>
      data.moveBudgetAmounts("person", "2026-04", [
        { fromCategoryId: null, toCategoryId: null, amount: 100 },
      ])
    ).toThrow(/two different/)
  })

  test("a category's detail has twelve months of spending and its last change", () => {
    const groceries = categoryId("Groceries")
    const detail = data.getBudgetCategoryDetail("2026-04", groceries)
    expect(detail.history).toHaveLength(12)
    expect(detail.history[0]).toEqual({ month: "2025-05", spent: 0 })
    expect(detail.history.at(-1)).toEqual({ month: "2026-04", spent: 4_210 })
    expect(detail.lastChange).toMatchObject({
      actor: "person",
      summary: "Planned €100.00 less for Groceries in 2026-04",
    })
    data.moveBudgetAmounts("person", "2026-04", [
      {
        fromCategoryId: groceries,
        toCategoryId: categoryId("Rent"),
        amount: 500,
      },
    ])
    expect(
      data.getBudgetCategoryDetail("2026-04", groceries).lastChange
    ).toMatchObject({
      summary: "Moved €5.00 from Groceries to Rent in 2026-04",
    })
    data.setBudgetAmount("mcp:Claude", "2026-05", groceries, 45_000)
    expect(
      data.getBudgetCategoryDetail("2026-04", groceries).lastChange
    ).toMatchObject({ actor: "mcp:Claude" })
    expect(
      data.getBudgetCategoryDetail("2026-04", categoryId("Utilities"))
        .lastChange
    ).toBeNull()
  })
})
