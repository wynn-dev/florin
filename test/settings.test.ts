import { readdirSync, writeFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"

const home = useTempHome()

function categoryId(name: string): number {
  for (const g of data.listCategoryGroups()) {
    const c = g.categories.find((x) => x.name === name)
    if (c) return c.id
  }
  throw new Error(`no category ${name}`)
}

describe("first run", () => {
  test("a fresh florin needs every step, and starter categories replace the defaults", () => {
    expect(data.setupStatus()).toMatchObject({
      needsSetup: true,
      currencyFixed: false,
      accounts: 0,
      categoriesReplaceable: true,
      mcpTokens: 0,
    })
    data.applyStarterCategories("person", {
      groups: [
        { name: "Bills", categories: ["Rent", "Phone & internet"] },
        { name: "Everyday", categories: ["Groceries", "Eating out"] },
      ],
    })
    const groups = data.listCategoryGroups()
    expect(groups.map((g) => g.name)).toEqual(["Bills", "Everyday", "Income"])
    expect(groups[1].categories.map((c) => c.name)).toEqual([
      "Groceries",
      "Eating out",
    ])
    expect(() =>
      data.applyStarterCategories("person", {
        groups: [{ name: "Bills", categories: ["Rent", "rent"] }],
      })
    ).toThrow(data.InvalidInput)
  })

  test("accounts with starting balances keep categories replaceable; spending fixes them", () => {
    const a = data.createAccount("person", {
      name: "Checking",
      type: "checking",
      startingBalance: 10_000,
    })
    expect(data.setupStatus()).toMatchObject({
      accounts: 1,
      currencyFixed: true,
      categoriesReplaceable: true,
    })
    data.applyStarterCategories("person", { groups: [] })
    expect(data.listCategoryGroups().map((g) => g.name)).toEqual(["Income"])

    data.applyStarterCategories("person", {
      groups: [{ name: "Everyday", categories: ["Groceries"] }],
    })
    data.createTransaction("person", {
      accountId: a.id,
      date: "2026-11-01",
      amount: -1_000,
      categoryId: categoryId("Groceries"),
    })
    expect(data.setupStatus().categoriesReplaceable).toBe(false)
    expect(() => data.applyStarterCategories("person", { groups: [] })).toThrow(
      data.InvalidInput
    )
  })
})

describe("settings", () => {
  test("the budget currency is fixed once transactions exist", () => {
    expect(() => data.updateSettings("person", { currency: "USD" })).toThrow(
      /fixed once transactions exist/
    )
  })

  test("the locale is stored in its canonical form and checked", () => {
    expect(data.getSettings().locale).toBe("")
    expect(data.updateSettings("person", { locale: "de-de" }).locale).toBe(
      "de-DE"
    )
    expect(() => data.updateSettings("person", { locale: "x" })).toThrow(
      data.InvalidInput
    )
    expect(() => data.updateSettings("person", { locale: "" })).toThrow(
      data.InvalidInput
    )
    expect(data.getSettings().locale).toBe("de-DE")
  })

  test("saving an unchanged setting writes no change-log line", () => {
    const lines = () => data.listActivity({ limit: 500 }).total
    data.updateSettings("person", { publicUrl: "https://florin.example.com" })
    const before = lines()
    data.updateSettings("person", {
      publicUrl: "https://florin.example.com/",
      locale: "de-DE",
      currency: data.getSettings().currency,
    })
    expect(lines()).toBe(before)
  })

  test("today and this month are in the person's time zone, not UTC", () => {
    // 23:30 UTC on 31 Jan is already 1 Feb in Helsinki and still 31 Jan in New York.
    const late = new Date("2026-01-31T23:30:00Z")
    data.updateSettings("person", { timeZone: "Europe/Helsinki" })
    expect(data.today(late)).toBe("2026-02-01")
    expect(data.thisMonth(late)).toBe("2026-02")
    data.updateSettings("person", { timeZone: "America/New_York" })
    expect(data.today(late)).toBe("2026-01-31")
    expect(() =>
      data.updateSettings("person", { timeZone: "Mars/Olympus" })
    ).toThrow(data.InvalidInput)
    // Empty means the machine's own zone.
    data.updateSettings("person", { timeZone: "" })
    expect(data.effectiveTimeZone()).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone
    )
  })
})

describe("payee default category", () => {
  test("fills new transactions that arrive without a category", () => {
    const account = data.listAccounts()[0]
    const first = data.createTransaction("person", {
      accountId: account.id,
      date: "2026-11-02",
      amount: -2_500,
      payeeName: "Bakery Rossi",
    })
    expect(first.categoryId).toBeNull()
    const payee = data.setPayeeCategory(
      "mcp:Claude",
      first.payeeId!,
      categoryId("Groceries")
    )
    expect(payee.defaultCategoryId).toBe(categoryId("Groceries"))
    expect(data.listActivity({ limit: 1 }).items[0]).toMatchObject({
      actor: "mcp:Claude",
      summary: "Set Bakery Rossi's default category to Groceries",
    })

    const second = data.createTransaction("person", {
      accountId: account.id,
      date: "2026-11-03",
      amount: -1_800,
      payeeName: "Bakery Rossi",
    })
    expect(second.categoryName).toBe("Groceries")
    // An explicit null stays uncategorised.
    const third = data.createTransaction("person", {
      accountId: account.id,
      date: "2026-11-03",
      amount: -900,
      payeeName: "Bakery Rossi",
      categoryId: null,
    })
    expect(third.categoryId).toBeNull()

    const result = data.importTransactions("bank-sync", account.id, [
      { date: "2026-11-04", amount: -1_200, payee: "Bakery Rossi" },
      { date: "2026-11-04", amount: -500, payee: "Kiosk" },
    ])
    expect(result.added).toBe(2)
    const imported = data.listTransactions({
      from: "2026-11-04",
      to: "2026-11-04",
    }).items
    expect(
      Object.fromEntries(imported.map((t) => [t.payeeName, t.categoryName]))
    ).toEqual({ "Bakery Rossi": "Groceries", Kiosk: null })

    data.setPayeeCategory("person", first.payeeId!, null)
    expect(data.getPayee(first.payeeId!).defaultCategoryId).toBeNull()
  })
})

describe("export", () => {
  test("transactions as CSV, oldest first, amounts as plain decimals", () => {
    const csv = data.transactionsCsv().trim().split("\r\n")
    expect(csv[0]).toBe(
      "Date,Account,Payee,Category,Amount,Currency,Notes,Status,Bank description"
    )
    expect(csv).toHaveLength(1 + data.listTransactions().total)
    expect(csv[1]).toBe("2026-11-01,Checking,,Groceries,-10.00,EUR,,cleared,")
    expect(csv.at(-1)).toMatch(
      /^\d{4}-\d{2}-\d{2},Checking,Starting balance,Starting balances,100\.00,EUR,/
    )
    expect(csv).toContain(
      "2026-11-04,Checking,Bakery Rossi,Groceries,-12.00,EUR,,cleared,Bakery Rossi"
    )
  })

  test("the database copy is a complete SQLite file, made inside florin's folder", () => {
    const bytes = data.databaseCopy()
    const file = join(home.dir, "check.db")
    writeFileSync(file, bytes)
    const copy = new DatabaseSync(file)
    const { n } = copy
      .prepare("select count(*) as n from transactions")
      .get() as { n: number }
    copy.close()
    expect(n).toBe(data.listTransactions().total)
    expect(
      readdirSync(home.dir).filter((f) => f.startsWith(".export"))
    ).toEqual([])
  })
})

describe("locale", () => {
  test("the Needs-attention text follows the locale for amounts", () => {
    data.updateSettings("person", { locale: "de-DE" })
    const account = data.createAccount("person", {
      name: "Konto",
      type: "checking",
    }).id
    data.createTransaction("person", {
      accountId: account,
      date: data.today(),
      amount: 123_456,
      payeeName: "Salary",
      categoryId: categoryId("Income"),
    })
    // A day later, past any agent's grace period.
    const unassigned = data
      .needsAttention(new Date(Date.now() + 25 * 3_600_000))
      .items.find((i) => i.id === "unassigned")
    expect(unassigned?.text).toMatch(/^[\d.]+,\d{2}\s€ unassigned/)
    data.updateSettings("person", { locale: "en-GB" })
  })
})

describe("CSV export cells", () => {
  test("text that a spreadsheet would run as a formula stays text; amounts stay numbers", () => {
    expect(data.csvCell('=HYPERLINK("http://x")')).toBe(
      '"\'=HYPERLINK(""http://x"")"'
    )
    expect(data.csvCell("+31 20 555")).toBe("'+31 20 555")
    expect(data.csvCell("-cmd|' /C calc'!A0")).toBe("'-cmd|' /C calc'!A0")
    expect(data.csvCell("@SUM(A1)")).toBe("'@SUM(A1)")
    expect(data.csvCell("-42.10")).toBe("-42.10")
    expect(data.csvCell("Bakery, Rossi")).toBe('"Bakery, Rossi"')
  })
})
