// Cover what went over: one action raises every category over plan by what it
// is over, from the money not planned yet; all or none, one Activity entry,
// and undone by moving each amount back.
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
    date: "2026-03-01",
    amount: 100_000,
    payeeName: "Northwind Ltd",
    categoryId: categoryId("Income"),
  })
})

describe("cover what went over", () => {
  test("nothing over plan: refuses and changes nothing", () => {
    data.setBudgetAmount("person", "2026-03", categoryId("Groceries"), 20_000)
    const before = data.listActivity({ limit: 1 }).items[0].id
    expect(() => data.coverOverspending("person", "2026-03")).toThrow(
      /nothing is over plan/
    )
    expect(data.listActivity({ limit: 1 }).items[0].id).toBe(before)
  })

  test("enough money not planned yet: every category over ends at zero, one Activity entry", () => {
    const groceries = categoryId("Groceries")
    const dining = categoryId("Dining out")
    spend("2026-03-10", 26_000, "Groceries")
    spend("2026-03-12", 4_500, "Dining out")
    const before = data.getBudgetMonth("2026-03")
    expect(before.overspent).toBe(10_500)
    expect(before.toBudget).toBe(80_000)
    const aprilBefore = data.getBudgetMonth("2026-04").toBudget

    const { month, covered } = data.coverOverspending("person", "2026-03")
    expect(covered).toEqual(
      expect.arrayContaining([
        { categoryId: groceries, name: "Groceries", amount: 6_000 },
        { categoryId: dining, name: "Dining out", amount: 4_500 },
      ])
    )
    expect(month.overspent).toBe(0)
    expect(month.toBudget).toBe(80_000 - 10_500)
    expect(category("2026-03", groceries)).toMatchObject({
      budgeted: 26_000,
      available: 0,
    })
    expect(category("2026-03", dining)).toMatchObject({
      budgeted: 4_500,
      available: 0,
    })
    // Covered inside the month: April's money not planned yet is the same
    // (it no longer loses the overspending, but March planned it instead).
    expect(data.getBudgetMonth("2026-04").toBudget).toBe(aprilBefore)

    const [entry] = data.listActivityEntries().items
    expect(entry).toMatchObject({
      kind: "budget",
      count: 2,
      summary: "covered what went over in 2 categories",
    })
    expect(entry.lines).toEqual(
      expect.arrayContaining([
        "Planned €60.00 more for Groceries in 2026-03 to cover what went over",
        "Planned €45.00 more for Dining out in 2026-03 to cover what went over",
      ])
    )
  })

  test("undo moves each amount back to what is not planned yet", () => {
    const covered = [
      { categoryId: categoryId("Groceries"), amount: 6_000 },
      { categoryId: categoryId("Dining out"), amount: 4_500 },
    ]
    // What the dashboard's Undo sends.
    const month = data.moveBudgetAmounts(
      "person",
      "2026-03",
      covered.map((c) => ({
        fromCategoryId: c.categoryId,
        toCategoryId: null,
        amount: c.amount,
      }))
    )
    expect(month.overspent).toBe(10_500)
    expect(month.toBudget).toBe(80_000)
    expect(category("2026-03", categoryId("Groceries")).budgeted).toBe(20_000)
    expect(category("2026-03", categoryId("Dining out")).budgeted).toBe(0)
  })

  test("not enough money not planned yet: says by how much and changes nothing", () => {
    // Plan most of what is left, so 1,500 stays unplanned against 10,500 over.
    data.setBudgetAmount("person", "2026-03", categoryId("Rent"), 78_500)
    const before = data.getBudgetMonth("2026-03")
    expect(before.toBudget).toBe(1_500)
    const last = data.listActivity({ limit: 1 }).items[0].id
    expect(() => data.coverOverspending("person", "2026-03")).toThrow(
      "€105.00 went over plan in 2026-03 but only €15.00 is not planned yet: €90.00 short"
    )
    expect(data.getBudgetMonth("2026-03")).toEqual(before)
    expect(data.listActivity({ limit: 1 }).items[0].id).toBe(last)
  })

  test("carried-in leftover counts: only what is still over is planned", () => {
    const transport = categoryId("Transport")
    data.setBudgetAmount("person", "2026-03", categoryId("Rent"), 0)
    data.setBudgetAmount("person", "2026-04", transport, 0)
    data.setBudgetAmount("person", "2026-03", transport, 3_000)
    spend("2026-04-05", 5_000, "Transport")
    expect(category("2026-04", transport).available).toBe(-2_000)
    const { covered } = data.coverOverspending("person", "2026-04")
    expect(covered).toEqual([
      { categoryId: transport, name: "Transport", amount: 2_000 },
    ])
    expect(category("2026-04", transport)).toMatchObject({
      budgeted: 2_000,
      available: 0,
    })
  })
})
