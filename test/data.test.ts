import { describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"
import { closeDatabase } from "@/server/db"

const {
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
} = data

useTempHome()

function categoryId(name: string): number {
  for (const g of data.listCategoryGroups()) {
    const c = g.categories.find((x) => x.name === name)
    if (c) return c.id
  }
  throw new Error(`no category ${name}`)
}

describe("accounts", () => {
  test("a starting balance is booked as income and shows in the balance", () => {
    const a = data.createAccount("person", {
      name: "Checking",
      type: "checking",
      startingBalance: 150_000,
      startingDate: "2026-01-01",
    })
    expect(a).toMatchObject({
      balance: 150_000,
      onBudget: true,
      type: "checking",
    })
    const [t] = listTransactions({ accountId: a.id }).items
    expect(t).toMatchObject({
      amount: 150_000,
      payeeName: "Starting balance",
      categoryName: "Starting balances",
    })
  })

  test("investment accounts are off budget and worth their latest value", () => {
    const a = data.createAccount("person", {
      name: "Brokerage",
      type: "investment",
    })
    expect(a.onBudget).toBe(false)
    data.setAccountValue("person", a.id, "2026-01-31", 1_000_000)
    data.setAccountValue("person", a.id, "2026-02-28", 1_050_000)
    expect(data.getAccount(a.id).balance).toBe(1_050_000)
    data.replaceHoldings("person", a.id, [
      {
        symbol: "VWCE",
        name: "Vanguard FTSE All-World",
        quantity: 10.5,
        price: 100,
        value: 1_050_000,
        currency: "EUR",
        asOf: "2026-02-28",
      },
    ])
    expect(data.listHoldings(a.id)).toHaveLength(1)
  })

  test("refuses fractional cents and unknown types", () => {
    expect(() =>
      data.createAccount("person", {
        name: "X",
        type: "checking",
        startingBalance: 1.5,
      })
    ).toThrow(data.InvalidInput)
    expect(() =>
      data.createAccount("person", { name: "X", type: "boat" as never })
    ).toThrow(data.InvalidInput)
  })
})

describe("transactions", () => {
  test("add, filter, search, edit and delete", () => {
    const acct = data.createAccount("person", { name: "Card", type: "credit" })
    const t = createTransaction("person", {
      accountId: acct.id,
      date: "2026-01-05",
      amount: -4_250,
      payeeName: "Corner Grocer",
      categoryId: categoryId("Groceries"),
    })
    expect(t).toMatchObject({
      payeeName: "Corner Grocer",
      categoryName: "Groceries",
      status: "cleared",
    })
    createTransaction("person", {
      accountId: acct.id,
      date: "2026-01-09",
      amount: -1_200,
      payeeName: "corner grocer",
      notes: "milk",
    })
    expect(
      data.listPayees().items.filter((p) => p.name === "Corner Grocer")
    ).toHaveLength(1)

    expect(listTransactions({ accountId: acct.id }).total).toBe(2)
    expect(listTransactions({ search: "milk" }).items).toHaveLength(1)
    expect(
      listTransactions({ accountId: acct.id, uncategorized: true }).items
    ).toHaveLength(1)
    expect(
      listTransactions({ accountId: acct.id, from: "2026-01-06" }).items
    ).toHaveLength(1)

    const edited = updateTransaction("person", t.id, {
      amount: -5_000,
      status: "pending",
    })
    expect(edited).toMatchObject({ amount: -5_000, status: "pending" })
    expect(data.getAccount(acct.id)).toMatchObject({
      balance: -6_200,
      clearedBalance: -1_200,
    })
    deleteTransaction("person", t.id)
    expect(listTransactions({ accountId: acct.id }).total).toBe(1)
  })

  test("transfers keep both legs in step", () => {
    const from = data.createAccount("person", {
      name: "Current",
      type: "checking",
      startingBalance: 10_000,
    })
    const to = data.createAccount("person", {
      name: "Savings",
      type: "savings",
    })
    const t = createTransaction("person", {
      accountId: from.id,
      date: "2026-02-01",
      amount: -2_500,
      transferAccountId: to.id,
    })
    expect(t).toMatchObject({
      transferAccountId: to.id,
      transferAccountName: "Savings",
      payeeId: null,
    })
    expect(data.getAccount(to.id).balance).toBe(2_500)

    updateTransaction("person", t.id, { amount: -3_000 })
    expect(data.getAccount(to.id).balance).toBe(3_000)

    deleteTransaction("person", t.transferId!)
    expect(data.getAccount(from.id).balance).toBe(10_000)
    expect(data.getAccount(to.id).balance).toBe(0)
  })
})

describe("import", () => {
  test("skips rows the account already has, by the bank's id", () => {
    const acct = data.createAccount("person", {
      name: "Bank",
      type: "checking",
    })
    const rows = [
      {
        date: "2026-03-01",
        amount: -999,
        payee: "SPOTIFY AB",
        importedId: "tx-1",
      },
      {
        date: "2026-03-02",
        amount: -2_000,
        payee: "LIDL 1234",
        importedId: "tx-2",
        status: "pending" as const,
      },
    ]
    expect(data.importTransactions("person", acct.id, rows)).toMatchObject({
      added: 2,
      skipped: 0,
    })
    expect(data.importTransactions("person", acct.id, rows)).toEqual({
      added: 0,
      skipped: 2,
    })
    const t = listTransactions({ accountId: acct.id, search: "spotify" })
      .items[0]
    expect(t).toMatchObject({
      importedPayee: "SPOTIFY AB",
      payeeName: "Spotify Ab",
      importedId: "tx-1",
    })
  })

  test("CSV import maps columns and is idempotent, identical rows included", () => {
    const acct = data.createAccount("person", { name: "CSV", type: "checking" })
    const csv = [
      "Datum;Omschrijving;Bedrag",
      "03.04.2026;Bakery;-3,50",
      "03.04.2026;Bakery;-3,50",
      '04.04.2026;"Employer; Inc";2.500,00',
    ].join("\n")
    const mapping = {
      date: "Datum",
      payee: "Omschrijving",
      amount: "Bedrag",
      dateFormat: "DD.MM.YYYY" as const,
      decimal: "," as const,
    }
    expect(data.importCsv("person", acct.id, csv, mapping)).toMatchObject({
      added: 3,
      skipped: 0,
    })
    expect(data.importCsv("person", acct.id, csv, mapping)).toEqual({
      added: 0,
      skipped: 3,
    })
    expect(data.getAccount(acct.id).balance).toBe(250_000 - 700)
  })
})

describe("budget", () => {
  test("leftover carries into the next month", () => {
    const acct = data.createAccount("person", {
      name: "Budget test",
      type: "cash",
    })
    const dining = categoryId("Dining out")
    const before = data.getBudgetMonth("2025-05").toBudget
    createTransaction("person", {
      accountId: acct.id,
      date: "2025-05-01",
      amount: 300_000,
      payeeName: "Employer",
      categoryId: categoryId("Income"),
    })
    data.setBudgetAmount("person", "2025-05", dining, 20_000)
    createTransaction("person", {
      accountId: acct.id,
      date: "2025-05-10",
      amount: -15_000,
      payeeName: "Bistro",
      categoryId: dining,
    })

    const may = data.getBudgetMonth("2025-05")
    const cat = (m: typeof may) =>
      m.groups.flatMap((g) => g.categories).find((c) => c.id === dining)!
    expect(cat(may)).toMatchObject({
      budgeted: 20_000,
      activity: -15_000,
      available: 5_000,
    })
    expect(may.income).toBe(300_000)
    expect(may.toBudget - before).toBe(280_000)

    createTransaction("person", {
      accountId: acct.id,
      date: "2025-06-03",
      amount: -9_000,
      payeeName: "Bistro",
      categoryId: dining,
    })
    expect(cat(data.getBudgetMonth("2025-06"))).toMatchObject({
      budgeted: 0,
      activity: -9_000,
      available: -4_000,
    })

    data.setBudgetAmount("person", "2025-06", dining, 4_000)
    expect(cat(data.getBudgetMonth("2025-06")).available).toBe(0)
    expect(() =>
      data.setBudgetAmount("person", "2025-06", categoryId("Income"), 1)
    ).toThrow(data.InvalidInput)
  })
})

describe("reports", () => {
  test("summaries over a range", () => {
    const range = { from: "2025-05-01", to: "2025-06-30" }
    expect(data.incomeVsExpenses(range)).toEqual([
      { month: "2025-05", income: 300_000, expenses: 15_000 },
      { month: "2025-06", income: 0, expenses: 9_000 },
    ])
    expect(data.cashFlow(range)[0]).toEqual({
      month: "2025-05",
      inflow: 300_000,
      outflow: 15_000,
      transfers: 0,
      net: 285_000,
    })
    expect(data.spendingByCategory(range)).toEqual([
      expect.objectContaining({
        categoryName: "Dining out",
        groupName: "Everyday",
        amount: 24_000,
      }),
    ])
  })

  test("net worth counts investment value snapshots and debts", () => {
    const points = data.netWorth({ from: "2026-01-01", to: "2026-02-28" })
    expect(points).toHaveLength(2)
    const feb = points[1]
    expect(feb.netWorth).toBe(feb.assets - feb.debts)
    expect(feb.assets).toBeGreaterThanOrEqual(1_050_000)
  })

  test("transfers between on-budget accounts are not cash flow", () => {
    const a = data.createAccount("person", { name: "Flow A", type: "checking" })
    const b = data.createAccount("person", { name: "Flow B", type: "savings" })
    createTransaction("person", {
      accountId: a.id,
      date: "2024-01-15",
      amount: -10_000,
      transferAccountId: b.id,
    })
    expect(data.cashFlow({ from: "2024-01-01", to: "2024-01-31" })).toEqual([
      { month: "2024-01", inflow: 0, outflow: 0, transfers: 0, net: 0 },
    ])
  })
})

describe("currencies", () => {
  test("accounts in another currency are tracking-only and convert at the latest earlier rate", () => {
    expect(() =>
      data.createAccount("person", {
        name: "US checking",
        type: "checking",
        currency: "USD",
        onBudget: true,
      })
    ).toThrow(data.InvalidInput)
    const usd = data.createAccount("person", {
      name: "IBKR",
      type: "investment",
      currency: "USD",
    })
    expect(usd).toMatchObject({
      currency: "USD",
      onBudget: false,
      budgetBalance: null,
    })

    data.saveFxRates("person", [
      { date: "2023-01-02", currency: "USD", rate: 1.0 },
      { date: "2023-02-01", currency: "USD", rate: 1.25 },
    ])
    expect(data.convert(12_500, "USD", "EUR", "2023-02-15")).toBe(10_000)
    expect(data.convert(10_000, "EUR", "USD", "2023-01-20")).toBe(10_000)
    expect(data.convert(100, "USD", "EUR", "2022-12-31")).toBeNull()
    expect(data.convert(1_000, "USD", "JPY", "2023-02-15")).toBeNull()

    data.setAccountValue("person", usd.id, "2023-01-31", 50_000)
    data.setAccountValue("person", usd.id, "2023-02-28", 62_500)
    const [jan, feb] = data.netWorth({ from: "2023-01-01", to: "2023-02-28" })
    expect(jan.assets).toBe(50_000)
    expect(feb.assets).toBe(50_000)
  })

  test("transfers between currencies need the arriving amount", () => {
    const eur = data.createAccount("person", {
      name: "EUR current",
      type: "checking",
      startingBalance: 100_000,
    })
    const usd = data.createAccount("person", {
      name: "USD cash",
      type: "cash",
      currency: "USD",
    })
    expect(() =>
      createTransaction("person", {
        accountId: eur.id,
        date: "2023-03-01",
        amount: -10_000,
        transferAccountId: usd.id,
      })
    ).toThrow(data.InvalidInput)
    const t = createTransaction("person", {
      accountId: eur.id,
      date: "2023-03-01",
      amount: -10_000,
      transferAccountId: usd.id,
      transferAmount: 10_800,
    })
    expect(data.getAccount(usd.id).balance).toBe(10_800)
    updateTransaction("person", t.id, { amount: -20_000 })
    expect(data.getAccount(usd.id).balance).toBe(10_800)
    updateTransaction("person", t.id, { transferAmount: 21_600 })
    expect(data.getAccount(usd.id).balance).toBe(21_600)
  })

  test("the budget currency can't change under an on-budget account", () => {
    expect(() => data.updateSettings("person", { currency: "USD" })).toThrow(
      data.InvalidInput
    )
  })
})

describe("bulk writes and the change log", () => {
  test("adds many transactions at once, or none when one is invalid", () => {
    const acct = data.createAccount("mcp:Claude", {
      name: "Bulk",
      type: "checking",
    })
    const added = data.createTransactions("mcp:Claude", [
      {
        accountId: acct.id,
        date: "2024-05-01",
        amount: -1_000,
        payeeName: "A",
      },
      {
        accountId: acct.id,
        date: "2024-05-02",
        amount: -2_000,
        payeeName: "B",
      },
    ])
    expect(added.map((t) => t.payeeName)).toEqual(["A", "B"])
    expect(() =>
      data.createTransactions("mcp:Claude", [
        { accountId: acct.id, date: "2024-05-03", amount: -3_000 },
        { accountId: acct.id, date: "not a date", amount: -4_000 },
      ])
    ).toThrow(data.InvalidInput)
    expect(listTransactions({ accountId: acct.id }).total).toBe(2)

    const groceries = categoryId("Groceries")
    const updated = data.updateTransactions(
      "mcp:Claude",
      added.map((t) => t.id),
      { categoryId: groceries }
    )
    expect(updated.every((t) => t.categoryId === groceries)).toBe(true)

    data.deleteTransactions(
      "mcp:Claude",
      added.map((t) => t.id)
    )
    expect(listTransactions({ accountId: acct.id }).total).toBe(0)
  })

  test("sets several budget amounts in one call", () => {
    const month = data.setBudgetAmounts("person", "2024-07", [
      { categoryId: categoryId("Rent"), amount: 100_000 },
      { categoryId: categoryId("Groceries"), amount: 40_000 },
    ])
    expect(month.budgeted).toBe(140_000)
    expect(() =>
      data.setBudgetAmounts("person", "2024-07", [
        { categoryId: categoryId("Income"), amount: 1 },
      ])
    ).toThrow(data.InvalidInput)
  })

  test("every write is in the activity log with its actor", () => {
    const mcp = data.listActivity({ actor: "mcp:" })
    expect(mcp.items.map((c) => c.summary)).toEqual([
      "Deleted −€20.00 at B in Bulk on 2024-05-02",
      "Deleted −€10.00 at A in Bulk on 2024-05-01",
      "Categorised −€20.00 at B in Bulk on 2024-05-02 as Groceries",
      "Categorised −€10.00 at A in Bulk on 2024-05-01 as Groceries",
      "Added −€20.00 at B in Bulk on 2024-05-02",
      "Added −€10.00 at A in Bulk on 2024-05-01",
      "Added checking account Bulk",
    ])
    expect(mcp.items.every((c) => c.actor === "mcp:Claude")).toBe(true)
    expect(data.listActivity({ limit: 2 })).toMatchObject({
      items: [{ entity: "budget" }, { entity: "budget" }],
    })
    expect(data.listActivity().total).toBeGreaterThan(20)
    expect(() => data.createPayee("someone" as never, "X")).toThrow(
      data.InvalidInput
    )
  })
})

describe("input checks", () => {
  test("malformed lists and rows are refused as invalid input", () => {
    const acct = data.createAccount("person", {
      name: "Checks",
      type: "checking",
    })
    const invalid = data.InvalidInput
    expect(() => data.createTransactions("person", [null as never])).toThrow(
      invalid
    )
    expect(() => data.createTransactions("person", null as never)).toThrow(
      invalid
    )
    expect(() =>
      data.importTransactions("person", acct.id, [null as never])
    ).toThrow(invalid)
    expect(() =>
      data.setBudgetAmounts("person", "2024-08", [null as never])
    ).toThrow(invalid)
    expect(() =>
      data.importTransactions("person", acct.id, [
        { date: "2024-08-01", amount: -100, payee: "X", categoryId: 99_999 },
      ])
    ).toThrow(/no category 99999/)
  })

  test("a transfer leg can't move into the other leg's account", () => {
    const a = data.createAccount("person", { name: "Leg A", type: "checking" })
    const b = data.createAccount("person", { name: "Leg B", type: "savings" })
    const t = createTransaction("person", {
      accountId: a.id,
      date: "2024-08-02",
      amount: -500,
      transferAccountId: b.id,
    })
    expect(() =>
      updateTransaction("person", t.id, { accountId: b.id })
    ).toThrow(data.InvalidInput)
    expect(() =>
      updateTransaction("person", t.transferId!, { accountId: a.id })
    ).toThrow(data.InvalidInput)
  })

  test("CSV amounts use the account currency's decimals", () => {
    const yen = data.createAccount("person", {
      name: "Yen",
      type: "cash",
      currency: "JPY",
    })
    const csv =
      "Date,Payee,Amount\n2024-08-03,Konbini,-1200\n2024-08-04,Ramen,-980.00"
    data.importCsv("person", yen.id, csv, {
      date: "Date",
      payee: "Payee",
      amount: "Amount",
    })
    expect(data.getAccount(yen.id).balance).toBe(-2_180)
  })
})

describe("stable keys", () => {
  test("opening balances are found by key after a rename, and deleted defaults stay deleted", () => {
    const groups = data.listCategoryGroups()
    const starting = groups
      .flatMap((g) => g.categories)
      .find((c) => c.name === "Starting balances")!
    data.updateCategory("person", starting.id, { name: "Opening balances" })
    const account = data.createAccount("person", {
      name: "Renamed check",
      type: "checking",
      startingBalance: 5_000,
    })
    const rows = data.listTransactions({ accountId: account.id }).items
    expect(rows.map((t) => t.categoryId)).toEqual([starting.id])

    for (const g of data.listCategoryGroups())
      data.deleteCategoryGroup("person", g.id)
    closeDatabase()
    expect(data.listCategoryGroups()).toEqual([])
  })
})

describe("payee clean-up", () => {
  test("title-cases shouting names without mangling Ä, Ö or apostrophes", () => {
    expect(data.cleanPayee("  KÄYTTÖTILI  ÖLJY ")).toBe("Käyttötili Öljy")
    expect(data.cleanPayee("MCDONALD'S 123")).toBe("Mcdonald's 123")
    expect(data.cleanPayee("Bakery Rossi")).toBe("Bakery Rossi")
  })
})

describe("transfers across currencies", () => {
  test("a leg can't be moved into an account in another currency without saying what arrives", () => {
    const eur = data.createAccount("person", {
      name: "EUR a",
      type: "checking",
    })
    const eur2 = data.createAccount("person", {
      name: "EUR b",
      type: "savings",
    })
    const usd = data.createAccount("person", {
      name: "USD c",
      type: "savings",
      currency: "USD",
    })
    const t = data.createTransaction("person", {
      accountId: eur.id,
      date: "2026-10-01",
      amount: -10_000,
      transferAccountId: eur2.id,
    })
    expect(() =>
      data.updateTransaction("person", t.id, { transferAccountId: usd.id })
    ).toThrow(/transferAmount/)
    expect(() =>
      data.updateTransaction("person", t.id, { accountId: usd.id })
    ).toThrow(/transferAmount/)
    const moved = data.updateTransaction("person", t.id, {
      transferAccountId: usd.id,
      transferAmount: 10_800,
    })
    expect(moved.transferAmount).toBe(10_800)
    // Within the same pair of currencies, other edits need nothing more.
    data.updateTransaction("person", t.id, { notes: "rent share" })
  })
})

describe("amount search", () => {
  test("respects each currency's decimals (JPY has none)", () => {
    const yen = data.createAccount("person", {
      name: "Yen wallet",
      type: "cash",
      currency: "JPY",
    })
    const euro = data.createAccount("person", {
      name: "Euro wallet",
      type: "cash",
    })
    const y = data.createTransaction("person", {
      accountId: yen.id,
      date: "2026-10-02",
      amount: -1200,
      payeeName: "Ramen",
    })
    const e = data.createTransaction("person", {
      accountId: euro.id,
      date: "2026-10-02",
      amount: -120_000,
      payeeName: "Laptop",
    })
    const ids = (search: string) =>
      data.listTransactions({ search, limit: 1000 }).items.map((t) => t.id)
    expect(ids("1200")).toEqual(expect.arrayContaining([y.id, e.id]))
    expect(ids("1200,00")).toEqual(expect.arrayContaining([y.id, e.id]))
    expect(ids("12.00")).not.toContain(y.id)
    expect(ids("1200.50")).not.toContain(y.id)
  })
})
