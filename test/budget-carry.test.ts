// Month by month: leftover carries into the next month; overspending shows in
// its own month, then resets to zero and comes out of Ready to assign.
import { beforeAll, describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"

useTempHome()

let account = 0

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

function spend(date: string, amount: number, name: string) {
  data.createTransaction("person", {
    accountId: account,
    date,
    amount: -amount,
    categoryId: categoryId(name),
  })
}

beforeAll(() => {
  account = data.createAccount("person", {
    name: "Everyday account",
    type: "checking",
  }).id
  data.createTransaction("person", {
    accountId: account,
    date: "2026-01-02",
    amount: 500_000,
    payeeName: "Northwind Ltd",
    categoryId: categoryId("Income"),
  })
})

describe("months with history but no assignments", () => {
  test("each month shows only its own overspending", () => {
    // Three months of spending before any budget.
    spend("2026-01-10", 12_000, "Groceries")
    spend("2026-02-11", 9_000, "Groceries")
    spend("2026-03-12", 30_000, "Dining out")
    const groceries = categoryId("Groceries")
    expect(category("2026-01", groceries).available).toBe(-12_000)
    expect(category("2026-02", groceries).available).toBe(-9_000)
    expect(category("2026-03", groceries).available).toBe(0)
    expect(category("2026-04", categoryId("Dining out")).available).toBe(0)

    const january = data.getBudgetMonth("2026-01")
    expect(january.toBudget).toBe(500_000)
    expect(january.overspent).toBe(12_000)
    expect(data.getBudgetMonth("2026-02")).toMatchObject({
      toBudget: 488_000,
      lastMonthOverspent: 12_000,
      overspent: 9_000,
    })
    // March's own overspending lowers April's, not March's.
    expect(data.getBudgetMonth("2026-03").toBudget).toBe(479_000)
    expect(data.getBudgetMonth("2026-04")).toMatchObject({
      toBudget: 449_000,
      lastMonthOverspent: 30_000,
      overspent: 0,
      available: 0,
    })
  })

  test("a category with activity only in the past stays at zero", () => {
    const later = data.getBudgetMonth("2026-09")
    expect(later.toBudget).toBe(449_000)
    expect(later.lastMonthOverspent).toBe(0)
    expect(category("2026-09", categoryId("Groceries"))).toMatchObject({
      budgeted: 0,
      activity: 0,
      available: 0,
    })
  })
})

describe("carrying", () => {
  test("leftover carries month to month", () => {
    const transport = categoryId("Transport")
    data.setBudgetAmount("person", "2026-04", transport, 10_000)
    spend("2026-04-05", 6_000, "Transport")
    expect(category("2026-04", transport).available).toBe(4_000)
    data.setBudgetAmount("person", "2026-05", transport, 10_000)
    expect(category("2026-05", transport)).toMatchObject({
      budgeted: 10_000,
      activity: 0,
      available: 14_000,
    })
    // With nothing assigned or spent it keeps carrying.
    expect(category("2026-07", transport).available).toBe(14_000)
  })

  test("overspending resets and lowers next month's ready to assign by exactly that amount", () => {
    const shopping = categoryId("Shopping")
    data.setBudgetAmount("person", "2026-05", shopping, 5_000)
    const juneBefore = data.getBudgetMonth("2026-06").toBudget
    spend("2026-05-20", 7_250, "Shopping")
    expect(category("2026-05", shopping).available).toBe(-2_250)
    expect(data.getBudgetMonth("2026-05").overspent).toBe(2_250)
    expect(category("2026-06", shopping).available).toBe(0)
    const june = data.getBudgetMonth("2026-06")
    expect(june.toBudget).toBe(juneBefore - 2_250)
    expect(june.lastMonthOverspent).toBe(2_250)
  })

  test("covering overspending inside the month leaves next month untouched", () => {
    const holidays = categoryId("Holidays")
    const transport = categoryId("Transport")
    const julyBefore = data.getBudgetMonth("2026-07").toBudget
    spend("2026-06-14", 3_000, "Holidays")
    expect(data.getBudgetMonth("2026-07").toBudget).toBe(julyBefore - 3_000)

    data.moveBudgetAmounts("person", "2026-06", [
      { fromCategoryId: transport, toCategoryId: holidays, amount: 3_000 },
    ])
    expect(category("2026-06", holidays).available).toBe(0)
    expect(data.getBudgetMonth("2026-06").overspent).toBe(0)
    expect(data.getBudgetMonth("2026-07").toBudget).toBe(julyBefore)
    expect(category("2026-07", transport).available).toBe(11_000)
  })

  test("hidden categories carry and count the same way", () => {
    const insurance = categoryId("Insurance")
    data.updateCategory("person", insurance, { hidden: true })
    data.setBudgetAmount("person", "2026-07", insurance, 2_000)
    expect(category("2026-08", insurance)).toMatchObject({
      hidden: true,
      available: 2_000,
    })
    const septemberBefore = data.getBudgetMonth("2026-09").toBudget
    spend("2026-08-03", 2_500, "Insurance")
    expect(category("2026-08", insurance).available).toBe(-500)
    expect(category("2026-09", insurance).available).toBe(0)
    expect(data.getBudgetMonth("2026-09").toBudget).toBe(septemberBefore - 500)
  })
})
