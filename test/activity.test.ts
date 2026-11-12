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

function latest() {
  return data.listActivityEntries({ limit: 1 }).items[0]
}

let checking = 0
let usd = 0

describe("activity entries", () => {
  test("one data-layer call is one entry, however many rows it touched", () => {
    checking = data.createAccount("person", {
      name: "Checking",
      type: "checking",
    }).id
    expect(latest()).toMatchObject({
      actor: "person",
      kind: "accounts",
      count: 1,
      summary: "added checking account Checking",
    })

    const result = data.importTransactions("bank-sync:Revolut", checking, [
      { date: "2026-11-01", amount: -4_210, payee: "LIDL" },
      { date: "2026-11-02", amount: -1_250, payee: "Café Lune" },
      { date: "2026-11-03", amount: 250_000, payee: "Northwind Labs" },
    ])
    expect(result).toMatchObject({ added: 3, skipped: 0 })
    const entry = latest()
    expect(entry).toMatchObject({
      id: result.change,
      actor: "bank-sync:Revolut",
      kind: "transactions",
      count: 3,
      transactions: 3,
      summary: "added 3 transactions",
      lines: [],
    })

    const ids = data
      .listTransactions({ change: entry.id })
      .items.map((t) => t.id)
    expect(ids).toHaveLength(3)
    data.updateTransactions("mcp:Claude Desktop", ids, {
      categoryId: categoryId("Groceries"),
    })
    expect(latest()).toMatchObject({
      actor: "mcp:Claude Desktop",
      count: 3,
      summary: "categorised 3 transactions",
    })
  })

  test("a single change reads as its own summary; an update that changes nothing logs nothing", () => {
    const [t] = data.listTransactions({ accountId: checking, limit: 1 }).items
    const before = latest().id
    data.updateTransaction("person", t.id, { categoryId: t.categoryId })
    expect(latest().id).toBe(before)

    data.updateTransaction("person", t.id, { notes: "Monthly salary" })
    expect(latest()).toMatchObject({ actor: "person", count: 1 })
    expect(latest().summary).toMatch(
      /^edited €2,500\.00 at Northwind Labs in Checking on 2026-11-03: memo edited$/
    )
  })

  test("a run wrapped in inBatch is one entry across calls and awaits", async () => {
    const savings = data.createAccount("person", {
      name: "Savings",
      type: "savings",
    }).id
    await data.inBatch(async () => {
      data.importTransactions("bank-sync:Revolut", checking, [
        { date: "2026-11-05", amount: -900, payee: "Coffee cart" },
      ])
      await new Promise((resolve) => setTimeout(resolve, 5))
      data.importTransactions("bank-sync:Revolut", savings, [
        { date: "2026-11-05", amount: 10_000, payee: "Interest" },
      ])
    })
    expect(latest()).toMatchObject({
      actor: "bank-sync:Revolut",
      count: 2,
      transactions: 2,
    })
  })

  test("deletes show as lines, mixed batches as counts", () => {
    const ids = ["Coffee", "Café"].map(
      (search) => data.listTransactions({ search }).items[0].id
    )
    data.deleteTransactions("person", ids)
    const entry = latest()
    expect(entry.summary).toBe("deleted 2 transactions")
    expect(entry.transactions).toBe(0)
    expect(entry.lineCount).toBe(2)
    expect(entry.lines[0]).toMatch(/^Deleted /)
  })

  test("filters by source, kind and time, and pages with a cursor", () => {
    const all = data.listActivityEntries({ limit: 200 }).items
    expect(
      data.listActivityEntries({ source: "mcp:" }).items.map((e) => e.actor)
    ).toEqual(["mcp:Claude Desktop"])
    expect(
      data
        .listActivityEntries({ source: "bank-sync:Revolut" })
        .items.every((e) => e.actor === "bank-sync:Revolut")
    ).toBe(true)
    expect(
      data.listActivityEntries({ kind: "accounts" }).items.map((e) => e.kind)
    ).toEqual(["accounts", "accounts"])
    expect(
      data.listActivityEntries({ from: "2999-01-01T00:00:00Z" }).items
    ).toEqual([])
    expect(
      data.listActivityEntries({ to: "2999-01-01T00:00:00Z" }).items
    ).toHaveLength(all.length)

    const first = data.listActivityEntries({ limit: 2 })
    expect(first.items).toHaveLength(2)
    const second = data.listActivityEntries({ limit: 2, before: first.next! })
    expect(second.items[0].id).toBeLessThan(first.items[1].id)
    expect(() => data.listActivityEntries({ kind: "x" as never })).toThrow(
      data.InvalidInput
    )
    expect(data.getActivityEntry(all[0].id)).toEqual(all[0])
    expect(data.listActivitySources()[0]).toBe("person")
  })

  test("a transaction's history lists who added it and each change", () => {
    const t = data.listTransactions({ search: "Northwind" }).items[0]
    expect(data.transactionHistory(t.id).map((h) => [h.actor, h.text])).toEqual(
      [
        ["bank-sync:Revolut", "Added"],
        ["mcp:Claude Desktop", "Category set to Groceries"],
        ["person", "Memo edited"],
      ]
    )
  })

  test("actors include banks, IBKR and imported files", () => {
    for (const actor of ["ibkr", "bank-sync:Revolut", "import:oct.csv"])
      expect(data.checkActor(actor)).toBe(actor)
    expect(() => data.checkActor("robot")).toThrow(data.InvalidInput)
  })
})

describe("transaction lists", () => {
  test("sums per currency, a running balance for one account, several categories, an amount search", () => {
    usd = data.createAccount("person", {
      name: "Brokerage",
      type: "investment",
      currency: "USD",
    }).id
    data.createTransaction("person", {
      accountId: checking,
      date: "2026-11-06",
      amount: -50_000,
      transferAccountId: usd,
      transferAmount: 54_000,
    })
    const page = data.listTransactions()
    expect(page.sums).toEqual(
      expect.arrayContaining([
        { currency: "USD", amount: 54_000 },
        {
          currency: "EUR",
          amount: page.items
            .filter((t) => t.accountId !== usd)
            .reduce((s, t) => s + t.amount, 0),
        },
      ])
    )
    const transfer = page.items.find(
      (t) => t.accountId === checking && t.transferId
    )
    expect(transfer).toMatchObject({ transferAmount: 54_000 })

    const register = data.listTransactions({ accountId: checking }).items
    const balance = data.getAccount(checking).balance
    expect(register[0].balance).toBe(balance)
    expect(register[1].balance).toBe(balance - register[0].amount)
    expect(data.listTransactions().items[0].balance).toBeUndefined()

    const groceries = categoryId("Groceries")
    expect(
      data.listTransactions({ categoryIds: [groceries, categoryId("Rent")] })
        .total
    ).toBe(data.listTransactions({ categoryId: groceries }).total)
    expect(
      data.listTransactions({ search: "500" }).items.map((t) => t.amount)
    ).toEqual([-50_000])
    expect(data.listTransactions({ search: "2500.00" }).total).toBe(1)
  })
})

describe("CSV preview and import", () => {
  const csv = [
    "Date;Description;Amount;Reference",
    "03.11.2026;ALBERT HEIJN 1043;-23,40;card",
    "04.11.2026;Northwind Labs;3.850,00;salary",
    "04.11.2026;Northwind Labs;3.850,00;salary",
  ].join("\n")

  test("guesses the mapping and counts what's new without importing", () => {
    const preview = data.previewCsv(checking, csv)
    expect(preview.mapping).toMatchObject({
      date: "Date",
      payee: "Description",
      amount: "Amount",
      notes: "Reference",
      dateFormat: "DD.MM.YYYY",
      decimal: ",",
    })
    expect(preview).toMatchObject({
      headers: ["Date", "Description", "Amount", "Reference"],
      rows: 3,
      added: 3,
      skipped: 0,
      error: null,
    })
    expect(preview.sample).toHaveLength(3)
  })

  test("importing twice adds nothing the second time", () => {
    const { mapping } = data.previewCsv(checking, csv)
    const first = data.importCsv("import:nov.csv", checking, csv, mapping)
    expect(first).toMatchObject({ added: 3, skipped: 0 })
    expect(latest()).toMatchObject({
      actor: "import:nov.csv",
      summary: "added 3 transactions",
    })
    expect(data.previewCsv(checking, csv)).toMatchObject({
      added: 0,
      skipped: 3,
    })
    expect(data.importCsv("import:nov.csv", checking, csv, mapping)).toEqual({
      added: 0,
      skipped: 3,
      change: undefined,
    })
  })

  test("a large import pages out whole by its change, so Undo can remove all of it", () => {
    const account = data.createAccount("person", {
      name: "History",
      type: "checking",
    }).id
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      date: `2025-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      amount: -(100 + i),
      payee: `Shop ${i % 40}`,
    }))
    const { change } = data.importTransactions("import:all.csv", account, rows)
    const ids = new Set<number>()
    for (let total = Infinity; ids.size < total;) {
      const page = data.listTransactions({
        change,
        limit: 1000,
        offset: ids.size,
      })
      if (!page.items.length) break
      page.items.forEach((t) => ids.add(t.id))
      total = page.total
    }
    expect(ids.size).toBe(1500)
    data.deleteTransactions("person", [...ids])
    expect(data.listTransactions({ accountId: account }).total).toBe(0)
  })

  test("a mapping that can't read the file says why", () => {
    const preview = data.previewCsv(checking, csv, {
      date: "Date",
      payee: "Description",
      amount: "Amount",
      dateFormat: "YYYY-MM-DD",
    })
    expect(preview.added).toBeNull()
    expect(preview.error).toMatch(/row 2/)
  })

  test("reads US dates, separate in and out columns, and times after dates", () => {
    const us = [
      "Posted Date,Payee,Debit,Credit",
      "11/13/2026 10:22,Shop,12.50,",
      "11/14/2026 08:00,Employer,,100.00",
    ].join("\n")
    const preview = data.previewCsv(checking, us)
    expect(preview.mapping).toMatchObject({
      date: "Posted Date",
      outflow: "Debit",
      inflow: "Credit",
      dateFormat: "MM/DD/YYYY",
      decimal: ".",
    })
    expect(preview.added).toBe(2)
  })
})
