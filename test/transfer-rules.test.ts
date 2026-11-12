// Rules that make moves between the person's own accounts transfers: linking
// to the other side's own row in a connected account whichever arrives
// second, ties, across currencies through the broker sync, legs created in a
// hand-kept account, apply_rules, undo; and the fixes found on real data
// (broker rows in suggestions, categories on transfers, starting balances,
// net worth's first day).
import { beforeAll, describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"
import { applyReports } from "@/server/ibkr/sync"
import { addMonths, today } from "@/server/data/validate"
import { reportQuery } from "@/components/reports/search"
import type { FlexAccountReport } from "@/server/ibkr/flex"
import type { ImportRow, Transaction } from "@/shared/types"

useTempHome()

let current = 0
let savings = 0
let broker = 0
let pocket = 0
let deposit = 0
let investments = 0
let holidays = 0

function categoryId(name: string): number {
  for (const g of data.listCategoryGroups()) {
    const c = g.categories.find((x) => x.name === name)
    if (c) return c.id
  }
  throw new Error(`no category ${name}`)
}

/** The row an import or a sync gave the id `importedId`. */
function row(accountId: number, importedId: string): Transaction {
  return data
    .listTransactions({ accountId, limit: 1000 })
    .items.find((t) => t.importedId === importedId)!
}

function bank(accountId: number, rows: (ImportRow & { importedId: string })[]) {
  return data.importTransactions("bank-sync:Test Bank", accountId, rows)
}

/** What the broker sync brings in: rows only, no values or holdings. */
function brokerSync(transactions: FlexAccountReport["transactions"]) {
  applyReports([
    {
      accountId: "UTEST01",
      currency: "USD",
      fromDate: "2026-09-01",
      toDate: "2026-09-30",
      generatedAt: null,
      missing: [],
      values: [],
      positions: null,
      cash: null,
      transactions,
    },
  ])
}

beforeAll(() => {
  const account = (input: Parameters<typeof data.createAccount>[1]) =>
    data.createAccount("person", input).id
  current = account({ name: "Current", type: "checking" })
  savings = account({ name: "Savings", type: "savings" })
  broker = account({ name: "Broker", type: "investment", currency: "USD" })
  pocket = account({ name: "Pocket", type: "savings" })
  deposit = account({ name: "Deposit", type: "savings", onBudget: false })
  data.linkAccount("person", current, {
    provider: "enablebanking",
    externalId: "cur",
  })
  data.linkAccount("person", savings, {
    provider: "enablebanking",
    externalId: "sav",
  })
  data.linkAccount("person", broker, {
    provider: "ibkr",
    externalId: "UTEST01",
  })
  data.saveFxRates("person", [
    { date: "2026-09-01", currency: "USD", rate: 1.16 },
  ])
  const goals = data.listCategoryGroups().find((g) => g.name === "Goals")!.id
  investments = data.createCategory("person", {
    groupId: goals,
    name: "Investments",
  }).id
  holidays = categoryId("Holidays")
  data.saveRules("person", [
    { pattern: "to savings", transferAccountId: savings },
    {
      pattern: "ibkr",
      categoryId: investments,
      transferAccountId: broker,
    },
    { pattern: "to pocket", transferAccountId: pocket },
    { pattern: "to deposit", categoryId: holidays, transferAccountId: deposit },
  ])
})

describe("saving transfer rules", () => {
  test("they list with their account, and can't name a closed one", () => {
    expect(data.listRules()[0]).toMatchObject({
      pattern: "to savings",
      transferAccountId: savings,
      transferAccountName: "Savings",
    })
    const closed = data.createAccount("person", {
      name: "Old savings",
      type: "savings",
    }).id
    data.updateAccount("person", closed, { closed: true })
    expect(() =>
      data.saveRules("person", [{ pattern: "old", transferAccountId: closed }])
    ).toThrow(/Old savings is closed/)
    expect(() =>
      data.saveRules("person", [{ pattern: "x", transferAccountId: 9999 }])
    ).toThrow(data.NotFound)
  })

  test("a later rule's account overrides an earlier one's; the row's own account is passed over", () => {
    const list = [
      {
        regex: /move/i,
        payee: null,
        categoryId: null,
        transferAccountId: pocket,
      },
      {
        regex: /move to savings/i,
        payee: null,
        categoryId: null,
        transferAccountId: savings,
      },
    ]
    const subject = { bankText: "MOVE TO SAVINGS", notes: "", payee: null }
    expect(
      data.runRules(list, { ...subject, accountId: current }).transferAccountId
    ).toBe(savings)
    expect(
      data.runRules(list, { ...subject, accountId: savings }).transferAccountId
    ).toBe(pocket)
  })
})

describe("linking to a connected account's own row", () => {
  test("the first side stays a plain row until the other arrives, then the two link", () => {
    bank(current, [
      {
        date: "2026-09-01",
        amount: -50_000,
        payee: "TO SAVINGS",
        importedId: "er:c1",
      },
    ])
    expect(row(current, "er:c1")).toMatchObject({
      transferId: null,
      payeeName: "To Savings",
    })
    const before = data.listActivity({ limit: 1 }).items[0].id
    bank(savings, [
      {
        date: "2026-09-02",
        amount: 50_000,
        payee: "FROM CURRENT",
        importedId: "er:s1",
      },
    ])
    const out = row(current, "er:c1")
    const into = row(savings, "er:s1")
    expect(out).toMatchObject({
      transferId: into.id,
      payeeId: null,
      categoryId: null,
      importedId: "er:c1",
      transferKept: true,
    })
    expect(into).toMatchObject({ transferId: out.id, categoryId: null })
    // The link is in the sync's own Activity entry.
    const lines = data
      .listActivity({ limit: 10 })
      .items.filter((c) => c.id > before)
    expect(new Set(lines.map((c) => c.batch)).size).toBe(1)
    expect(lines.map((c) => c.summary).reverse()).toEqual([
      "Added €500.00 at From Current in Savings on 2026-09-02",
      "Linked −€500.00 from Current to Savings on 2026-09-01 as a transfer",
      "Linked €500.00 from Savings to Current on 2026-09-02 as a transfer",
    ])
  })

  test("the other order: the other side is there first, and the move links as it arrives", () => {
    bank(savings, [
      {
        date: "2026-09-05",
        amount: 30_000,
        payee: "FROM CURRENT",
        importedId: "er:s2",
      },
    ])
    bank(current, [
      {
        date: "2026-09-06",
        amount: -30_000,
        payee: "TO SAVINGS",
        importedId: "er:c2",
      },
    ])
    expect(row(current, "er:c2").transferId).toBe(row(savings, "er:s2").id)
  })

  test("the closest date wins; two equally close link nothing", () => {
    bank(savings, [
      { date: "2026-09-10", amount: 20_000, payee: "IN", importedId: "er:s3" },
      { date: "2026-09-12", amount: 20_000, payee: "IN", importedId: "er:s4" },
      { date: "2026-09-20", amount: 25_000, payee: "IN", importedId: "er:s5" },
      { date: "2026-09-23", amount: 25_000, payee: "IN", importedId: "er:s6" },
    ])
    bank(current, [
      {
        date: "2026-09-11",
        amount: -20_000,
        payee: "TO SAVINGS",
        importedId: "er:c3",
      },
      {
        date: "2026-09-21",
        amount: -25_000,
        payee: "TO SAVINGS",
        importedId: "er:c4",
      },
    ])
    expect(row(current, "er:c3").transferId).toBeNull()
    expect(row(savings, "er:s3").transferId).toBeNull()
    expect(row(savings, "er:s4").transferId).toBeNull()
    expect(row(current, "er:c4").transferId).toBe(row(savings, "er:s5").id)
    expect(row(savings, "er:s6").transferId).toBeNull()
  })

  test("nothing links without a rule naming the account", () => {
    bank(current, [
      {
        date: "2026-09-14",
        amount: -7_700,
        payee: "CORNER MARKET",
        importedId: "er:c5",
      },
    ])
    bank(savings, [
      {
        date: "2026-09-14",
        amount: 7_700,
        payee: "REFUND",
        importedId: "er:s7",
      },
    ])
    expect(row(current, "er:c5").transferId).toBeNull()
    expect(row(savings, "er:s7").transferId).toBeNull()
  })

  test("across currencies through the broker sync: only the deposit, within the rate's slack, links", () => {
    bank(current, [
      {
        date: "2026-09-15",
        amount: -100_000,
        payee: "IBKR DEPOSIT",
        importedId: "er:c6",
      },
    ])
    // Stays plain, keeping what the rules gave it, until the broker reports.
    expect(row(current, "er:c6")).toMatchObject({
      transferId: null,
      categoryId: investments,
    })
    // At 1.16, €1,000 is $1,160: the sale has that exact amount a day
    // closer, the deposit is 0.3% off, and only the deposit can be a leg.
    brokerSync([
      {
        date: "2026-09-16",
        amount: 116_000,
        payee: "Sold 10 VWCE",
        importedId: "ib:trade-1",
      },
      {
        date: "2026-09-17",
        amount: 115_650,
        payee: "Deposit",
        importedId: "ib:dep-1",
      },
    ])
    const out = row(current, "er:c6")
    expect(out).toMatchObject({
      transferId: row(broker, "ib:dep-1").id,
      // The broker is off budget: the bank's leg keeps its category.
      categoryId: investments,
      transferAmount: 115_650,
    })
    expect(row(broker, "ib:dep-1")).toMatchObject({
      categoryId: null,
      payeeId: null,
    })
    expect(row(broker, "ib:trade-1").transferId).toBeNull()
  })

  test("money back from the broker links when the bank's row arrives second", () => {
    brokerSync([
      {
        date: "2026-09-25",
        amount: -58_000,
        payee: "Withdrawal",
        importedId: "ib:wd-1",
      },
    ])
    bank(current, [
      {
        date: "2026-09-28",
        amount: 50_000,
        payee: "FROM IBKR",
        importedId: "er:c7",
      },
    ])
    expect(row(current, "er:c7").transferId).toBe(row(broker, "ib:wd-1").id)
  })

  test("unlinking keeps both rows", () => {
    const out = row(current, "er:c2")
    data.updateTransaction("person", out.id, { transferAccountId: null })
    expect(row(current, "er:c2").transferId).toBeNull()
    expect(row(savings, "er:s2")).toMatchObject({
      transferId: null,
      amount: 30_000,
    })
  })
})

describe("an account kept by hand", () => {
  test("gets the other leg, with no category between two on-budget accounts", () => {
    bank(current, [
      {
        date: "2026-09-18",
        amount: -8_000,
        payee: "TO POCKET",
        importedId: "er:c8",
      },
    ])
    const out = row(current, "er:c8")
    expect(out).toMatchObject({
      transferAccountId: pocket,
      transferAmount: 8_000,
      transferKept: false,
      categoryId: null,
    })
    expect(data.getTransaction(out.transferId!)).toMatchObject({
      accountId: pocket,
      date: "2026-09-18",
      amount: 8_000,
    })
    expect(data.transactionHistory(out.id).at(-1)!.text).toBe(
      "Made a transfer to Pocket"
    )
    // Undo: the leg florin made goes; the bank's row stays.
    data.updateTransaction("person", out.id, { transferAccountId: null })
    expect(() => data.getTransaction(out.transferId!)).toThrow(data.NotFound)
    expect(row(current, "er:c8").transferId).toBeNull()
  })

  test("off budget, the on-budget leg keeps the rules' category", () => {
    bank(current, [
      {
        date: "2026-09-19",
        amount: -6_000,
        payee: "TO DEPOSIT",
        importedId: "er:c9",
      },
    ])
    expect(row(current, "er:c9")).toMatchObject({
      transferAccountId: deposit,
      categoryId: holidays,
    })
  })
})

describe("apply_rules", () => {
  test("a dry run says what would link and be created, and writes nothing", () => {
    bank(current, [
      {
        date: "2026-10-01",
        amount: -40_000,
        payee: "MONTHLY SAVE",
        importedId: "er:c10",
      },
      {
        date: "2026-10-01",
        amount: -1_500,
        payee: "MONTHLY POCKET",
        importedId: "er:c11",
      },
    ])
    bank(savings, [
      {
        date: "2026-10-02",
        amount: 40_000,
        payee: "IN",
        importedId: "er:s10",
      },
    ])
    data.saveRules("person", [
      { pattern: "monthly save", transferAccountId: savings },
      { pattern: "monthly pocket", transferAccountId: pocket },
    ])
    const dry = data.applyRules("person", { from: "2026-10-01", dryRun: true })
    expect(dry).toMatchObject({
      transfersLinked: 1,
      transfersCreated: 1,
      changed: 2,
    })
    expect(dry.change).toBeUndefined()
    expect(dry.sample).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: row(current, "er:c10").id,
          transfer: { account: "Savings", linkedId: row(savings, "er:s10").id },
        }),
        expect.objectContaining({
          id: row(current, "er:c11").id,
          transfer: { account: "Pocket" },
        }),
      ])
    )
    expect(row(current, "er:c10").transferId).toBeNull()
    expect(row(current, "er:c11").transferId).toBeNull()
  })

  test("then links and creates, in one Activity entry; a second run changes nothing", () => {
    const result = data.applyRules("person", { from: "2026-10-01" })
    expect(result).toMatchObject({ transfersLinked: 1, transfersCreated: 1 })
    expect(result.change).toBeDefined()
    expect(row(current, "er:c10").transferId).toBe(row(savings, "er:s10").id)
    expect(row(current, "er:c11").transferAccountId).toBe(pocket)
    const again = data.applyRules("person", { from: "2026-10-01" })
    expect(again).toMatchObject({
      changed: 0,
      transfersLinked: 0,
      transfersCreated: 0,
    })
  })

  test("the same rows always give the same links, oldest first", () => {
    // The tie from before stays a tie however often the rules run.
    data.applyRules("person", { from: "2026-09-01", to: "2026-09-30" })
    expect(row(current, "er:c3").transferId).toBeNull()
  })
})

describe("fixes found on real data", () => {
  test("suggest_transfers offers no broker trade, interest, dividend or fee", () => {
    bank(current, [
      {
        date: "2026-10-10",
        amount: -5_000,
        payee: "CARD SHOP",
        importedId: "er:c20",
      },
    ])
    brokerSync([
      {
        date: "2026-10-10",
        amount: 5_800,
        payee: "Interest",
        importedId: "ib:int-1",
      },
    ])
    const ids = data
      .suggestTransfers({ from: "2026-10-10" })
      .flatMap((s) => [s.out.id, s.into.id])
    expect(ids).not.toContain(row(broker, "ib:int-1").id)
  })

  test("making a transfer between two on-budget accounts clears the category however it is done", () => {
    const groceries = categoryId("Groceries")
    const [made] = data.createTransactions("person", [
      {
        accountId: current,
        date: "2026-10-11",
        amount: -1_000,
        categoryId: groceries,
        transferAccountId: savings,
      },
    ])
    expect(made.categoryId).toBeNull()
    const plain = data.createTransaction("person", {
      accountId: current,
      date: "2026-10-12",
      amount: -2_000,
      categoryId: groceries,
    })
    expect(
      data.updateTransaction("person", plain.id, { transferAccountId: savings })
        .categoryId
    ).toBeNull()
    const off = data.createTransaction("person", {
      accountId: current,
      date: "2026-10-12",
      amount: -3_000,
      categoryId: holidays,
    })
    expect(
      data.updateTransaction("person", off.id, { transferAccountId: deposit })
        .categoryId
    ).toBe(holidays)
  })

  test("a starting balance can't be linked or suggested", () => {
    const opened = data.createAccount("person", {
      name: "Old bank",
      type: "checking",
      startingBalance: 12_300,
      startingDate: "2026-10-13",
    })
    const openedOff = data.createAccount("person", {
      name: "Old broker",
      type: "investment",
      onBudget: false,
      startingBalance: 9_900,
      startingDate: "2026-10-13",
    })
    const start = data.listTransactions({ accountId: opened.id }).items[0]
    expect(start.startingBalance).toBe(true)
    const startOff = data.listTransactions({ accountId: openedOff.id }).items[0]
    expect(startOff.startingBalance).toBe(true)
    const [out, outOff] = data.createTransactions("person", [
      { accountId: current, date: "2026-10-13", amount: -12_300 },
      { accountId: current, date: "2026-10-13", amount: -9_900 },
    ])
    expect(() => data.linkTransfers("person", [[out.id, start.id]])).toThrow(
      /is a starting balance/
    )
    expect(() =>
      data.linkTransfers("person", [[outOff.id, startOff.id]])
    ).toThrow(/is a starting balance/)
    const ids = data
      .suggestTransfers({ from: "2026-10-13" })
      .flatMap((s) => [s.out.id, s.into.id])
    expect(ids).not.toContain(start.id)
    expect(ids).not.toContain(startOff.id)
  })

  test("net worth starts where an account first holds something", () => {
    const valued = data.createAccount("person", {
      name: "New broker",
      type: "investment",
      currency: "EUR",
      onBudget: false,
    }).id
    const start = addMonths(today().slice(0, 7), -11) + "-01"
    const firstDeposit = addMonths(today().slice(0, 7), -1) + "-15"
    const values = []
    for (let d = new Date(`${start}T00:00:00Z`); ;) {
      const date = d.toISOString().slice(0, 10)
      if (date > today()) break
      values.push({ date, value: date < firstDeposit ? 0 : 500_000 })
      d.setUTCDate(d.getUTCDate() + 1)
    }
    data.setAccountValues("person", valued, values)
    const report = data.netWorthReport({ accountIds: [valued], step: "week" })
    expect(report.dataFrom).toBe(firstDeposit)
    expect(report.from).toBe(firstDeposit)
    expect(report.points[0].netWorth).toBe(500_000)
    // The Reports page's default range is the server's, so it starts there too.
    expect(data.netWorthReport(reportQuery({ accounts: [valued] })).from).toBe(
      firstDeposit
    )
  })
})
