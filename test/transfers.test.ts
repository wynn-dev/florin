// Two rows florin already has, one per account (each bank sent its side),
// linked as one transfer: the checks, the category rule, what each leg keeps,
// unlinking and deleting without losing a bank's row, syncs and re-imports
// after linking, and the suggestions.
import { beforeAll, describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"
import { applyRows } from "@/server/enablebanking/sync"
import type { Transaction } from "@/shared/types"

useTempHome()

let current = 0
let savings = 0
let broker = 0

function categoryId(name: string): number {
  for (const g of data.listCategoryGroups()) {
    const c = g.categories.find((x) => x.name === name)
    if (c) return c.id
  }
  throw new Error(`no category ${name}`)
}

/** The row an import or a sync gave the bank id `importedId`. */
function row(accountId: number, importedId: string): Transaction {
  return data
    .listTransactions({ accountId, limit: 1000 })
    .items.find((t) => t.importedId === importedId)!
}

const currentRows = [
  {
    date: "2026-09-01",
    amount: -50_000,
    payee: "TRANSFER TO SAVINGS",
    importedId: "er:cur-1",
    notes: "monthly",
  },
  {
    date: "2026-09-10",
    amount: -100_000,
    payee: "BROKER DEPOSIT",
    importedId: "er:cur-2",
  },
  {
    date: "2026-09-12",
    amount: -2_000,
    payee: "CORNER MARKET",
    importedId: "er:cur-3",
  },
  {
    date: "2026-09-20",
    amount: -7_500,
    payee: "TO SAVINGS",
    importedId: "er:cur-4",
  },
]
const savingsRows = [
  {
    date: "2026-09-02",
    amount: 50_000,
    payee: "FROM CURRENT",
    importedId: "er:sav-1",
  },
  {
    date: "2026-09-20",
    amount: 7_250,
    payee: "FROM CURRENT",
    importedId: "er:sav-2",
  },
]

beforeAll(() => {
  current = data.createAccount("person", {
    name: "Current",
    type: "checking",
  }).id
  savings = data.createAccount("person", {
    name: "Savings",
    type: "savings",
  }).id
  broker = data.createAccount("person", {
    name: "Broker",
    type: "investment",
    currency: "USD",
  }).id
  data.saveFxRates("person", [
    { date: "2026-09-01", currency: "USD", rate: 1.16 },
  ])
  data.importTransactions("bank-sync:Test Bank", current, currentRows)
  data.importTransactions("bank-sync:Test Bank", savings, savingsRows)
  data.importTransactions("ibkr", broker, [
    {
      date: "2026-09-12",
      amount: 116_740,
      payee: "Deposit",
      importedId: "ibkr:dep-1",
    },
  ])
  // Categorised before anyone noticed they were transfers.
  data.updateTransactions("person", [row(current, "er:cur-1").id], {
    categoryId: categoryId("Emergency fund"),
  })
  data.updateTransactions("person", [row(current, "er:cur-2").id], {
    categoryId: categoryId("Holidays"),
  })
})

describe("suggest transfers", () => {
  test("finds same-currency pairs and cross-currency ones within 3%", () => {
    const suggestions = data.suggestTransfers()
    expect(
      suggestions.map((s) => [s.out.importedId, s.into.importedId, s.days])
    ).toEqual([
      ["er:cur-2", "ibkr:dep-1", 2],
      ["er:cur-1", "er:sav-1", 1],
    ])
    // −75.00 against +72.50: not equal, so not a pair.
    expect(suggestions.some((s) => s.out.importedId === "er:cur-4")).toBe(false)
  })

  test("narrows by account and dates", () => {
    expect(data.suggestTransfers({ accountId: savings })).toHaveLength(1)
    expect(data.suggestTransfers({ from: "2026-09-05" })).toHaveLength(1)
    expect(data.suggestTransfers({ to: "2026-09-01" })).toHaveLength(0)
  })
})

describe("linking", () => {
  test("refuses rows that can't be one transfer, all or none", () => {
    const out = row(current, "er:cur-1").id
    const into = row(savings, "er:sav-1").id
    const grocery = row(current, "er:cur-3").id
    const fewer = row(current, "er:cur-4").id
    const fewerIn = row(savings, "er:sav-2").id
    const refuse = (pairs: [number, number][], message: RegExp) =>
      expect(() => data.linkTransfers("person", pairs)).toThrow(message)
    refuse([[out, out]], /two different transactions/)
    refuse([[out, grocery]], /same account/)
    refuse([[out, row(broker, "ibkr:dep-1").id + 1000]], /transaction \d+/)
    refuse([[grocery, row(current, "er:cur-2").id]], /same account/)
    refuse([[fewer, fewerIn]], /the amounts differ by €2\.50/)
    refuse(
      [
        [out, into],
        [into, fewerIn],
      ],
      /item 2 of 2: transaction \d+ is in two pairs/
    )
    refuse(
      [
        [out, into],
        [fewer, fewerIn],
      ],
      /item 2 of 2: the amounts differ/
    )
    // Nothing of the refused calls stuck.
    expect(row(current, "er:cur-1").transferId).toBeNull()
  })

  test("two on-budget rows become a transfer with no payee or category, each keeping its bank fields", () => {
    const before = data.listActivity({ limit: 1 }).items[0].id
    const [[out, into]] = data.linkTransfers("mcp:agent", [
      [row(savings, "er:sav-1").id, row(current, "er:cur-1").id],
    ])
    expect(out).toMatchObject({
      accountId: current,
      amount: -50_000,
      date: "2026-09-01",
      notes: "monthly",
      importedId: "er:cur-1",
      importedPayee: "TRANSFER TO SAVINGS",
      payeeId: null,
      categoryId: null,
      transferId: into.id,
      transferAccountName: "Savings",
      transferKept: true,
    })
    expect(into).toMatchObject({
      accountId: savings,
      amount: 50_000,
      date: "2026-09-02",
      importedId: "er:sav-1",
      payeeId: null,
      categoryId: null,
      transferId: out.id,
      transferAccountName: "Current",
    })
    // One Activity entry.
    const lines = data
      .listActivity({ limit: 10 })
      .items.filter((c) => c.id > before)
    expect(new Set(lines.map((c) => c.batch)).size).toBe(1)
    expect(lines.map((c) => c.summary).reverse()).toEqual([
      "Linked −€500.00 from Current to Savings on 2026-09-01 as a transfer",
      "Linked €500.00 from Savings to Current on 2026-09-02 as a transfer",
    ])
    expect(() =>
      data.linkTransfers("person", [[out.id, row(current, "er:cur-4").id]])
    ).toThrow(/already a transfer/)
  })

  test("across currencies each leg keeps its amount; the on-budget leg keeps its category", () => {
    const [[out, into]] = data.linkTransfers("person", [
      [row(current, "er:cur-2").id, row(broker, "ibkr:dep-1").id],
    ])
    expect(out).toMatchObject({
      amount: -100_000,
      categoryId: categoryId("Holidays"),
      transferAmount: 116_740,
    })
    expect(into).toMatchObject({
      amount: 116_740,
      categoryId: null,
      transferAmount: -100_000,
    })
    expect(data.suggestTransfers()).toEqual([])
  })

  test("re-importing or syncing after linking adds nothing and keeps the other leg", () => {
    expect(
      data.importTransactions("bank-sync:Test Bank", current, currentRows)
    ).toMatchObject({ added: 0 })
    expect(
      data.importTransactions("bank-sync:Test Bank", savings, savingsRows)
    ).toMatchObject({ added: 0 })
    const counts = applyRows(
      "bank-sync:Test Bank",
      current,
      currentRows.map((r) => ({
        ...r,
        status: "cleared" as const,
        cancelled: false,
      })),
      "2026-09-01"
    )
    expect(counts).toMatchObject({ added: 0, removed: 0 })
    expect(row(current, "er:cur-1").transferId).toBe(
      row(savings, "er:sav-1").id
    )
  })

  test("a sync booking a pending leg on a new date leaves the other leg alone", () => {
    data.importTransactions("bank-sync:Test Bank", current, [
      {
        date: "2026-10-01",
        amount: -30_000,
        payee: "TO SAVINGS",
        importedId: "er:cur-5",
        status: "pending",
      },
    ])
    const pending = row(current, "er:cur-5")
    data.importTransactions("bank-sync:Test Bank", savings, [
      {
        date: "2026-10-02",
        amount: 30_000,
        payee: "FROM CURRENT",
        importedId: "er:sav-5",
        notes: "kept",
      },
    ])
    const other = row(savings, "er:sav-5")
    data.linkTransfers("person", [[pending.id, other.id]])
    applyRows(
      "bank-sync:Test Bank",
      current,
      [
        {
          date: "2026-10-03",
          amount: -30_000,
          payee: "TO SAVINGS",
          importedId: "er:cur-5",
          status: "cleared",
          cancelled: false,
        },
      ],
      "2026-10-01"
    )
    expect(row(current, "er:cur-5")).toMatchObject({
      status: "cleared",
      date: "2026-10-03",
      transferId: other.id,
    })
    expect(row(savings, "er:sav-5")).toMatchObject({
      date: "2026-10-02",
      status: "cleared",
      notes: "kept",
      amount: 30_000,
      transferId: pending.id,
    })
  })

  test("a pending leg the bank drops leaves the other leg as a plain row", () => {
    data.importTransactions("bank-sync:Test Bank", current, [
      {
        date: "2026-10-05",
        amount: -1_000,
        payee: "TO SAVINGS",
        importedId: "er:cur-6",
        status: "pending",
      },
    ])
    data.importTransactions("bank-sync:Test Bank", savings, [
      {
        date: "2026-10-05",
        amount: 1_000,
        payee: "IN",
        importedId: "er:sav-6",
      },
    ])
    data.linkTransfers("person", [
      [row(current, "er:cur-6").id, row(savings, "er:sav-6").id],
    ])
    applyRows("bank-sync:Test Bank", current, [], "2026-10-01")
    expect(row(current, "er:cur-6")).toBeUndefined()
    expect(row(savings, "er:sav-6").transferId).toBeNull()
  })
})

describe("unlinking", () => {
  test("a linked pair goes back to two plain rows", () => {
    const out = row(current, "er:cur-1")
    data.updateTransaction("person", out.id, { transferAccountId: null })
    expect(row(current, "er:cur-1").transferId).toBeNull()
    expect(row(savings, "er:sav-1")).toMatchObject({
      transferId: null,
      amount: 50_000,
    })
  })

  test("deleting one linked leg keeps the other bank row", () => {
    const out = row(current, "er:cur-2")
    data.deleteTransaction("person", out.id)
    expect(row(broker, "ibkr:dep-1")).toMatchObject({
      transferId: null,
      amount: 116_740,
    })
  })

  test("a transfer florin made itself still goes with its leg", () => {
    const made = data.createTransaction("person", {
      accountId: current,
      date: "2026-10-10",
      amount: -5_000,
      transferAccountId: savings,
    })
    expect(made.transferKept).toBe(false)
    data.updateTransaction("person", made.id, { transferAccountId: null })
    expect(() => data.getTransaction(made.transferId!)).toThrow(data.NotFound)
    expect(data.getTransaction(made.id).transferId).toBeNull()
  })

  test("undoing a link puts back each row's payee and category", () => {
    const [a, b] = data.createTransactions("person", [
      {
        accountId: current,
        date: "2026-10-20",
        amount: -1_200,
        payeeName: "Corner market",
        categoryId: categoryId("Groceries"),
      },
      {
        accountId: savings,
        date: "2026-10-20",
        amount: 1_200,
        payeeName: "Refund desk",
        categoryId: categoryId("Shopping"),
      },
    ])
    data.linkTransfers("person", [[a.id, b.id]])
    expect(data.getTransaction(a.id)).toMatchObject({
      payeeId: null,
      categoryId: null,
    })
    // What the dashboard's Undo sends.
    data.updateTransaction("person", a.id, {
      transferAccountId: null,
      payeeId: a.payeeId,
      categoryId: a.categoryId,
    })
    data.updateTransaction("person", b.id, {
      payeeId: b.payeeId,
      categoryId: b.categoryId,
    })
    for (const t of [a, b])
      expect(data.getTransaction(t.id)).toMatchObject({
        transferId: null,
        payeeName: t.payeeName,
        categoryId: t.categoryId,
      })
  })

  test("two rows typed in and linked both stay when unlinked", () => {
    const [a, b] = data.createTransactions("mcp:agent", [
      { accountId: current, date: "2026-10-11", amount: -900 },
      { accountId: savings, date: "2026-10-11", amount: 900 },
    ])
    data.linkTransfers("person", [[a.id, b.id]])
    expect(data.getTransaction(a.id).transferKept).toBe(true)
    data.updateTransaction("person", b.id, { transferAccountId: null })
    expect(data.getTransaction(a.id).transferId).toBeNull()
    expect(data.getTransaction(b.id).transferId).toBeNull()
  })

  test("unlinking the leg florin made never deletes the bank row it came from", () => {
    data.importTransactions("bank-sync:Test Bank", current, [
      {
        date: "2026-10-11",
        amount: -800,
        payee: "OUT",
        importedId: "er:cur-8",
      },
    ])
    const bank = row(current, "er:cur-8")
    const made = data.updateTransaction("person", bank.id, {
      transferAccountId: savings,
    })
    expect(made.transferKept).toBe(false)
    data.updateTransaction("person", made.transferId!, {
      transferAccountId: null,
    })
    expect(row(current, "er:cur-8").transferId).toBeNull()
  })

  test("editing a florin leg doesn't rewrite the bank leg's date, notes or status", () => {
    data.importTransactions("bank-sync:Test Bank", current, [
      {
        date: "2026-10-12",
        amount: -4_000,
        payee: "OUT",
        importedId: "er:cur-7",
      },
    ])
    const bank = row(current, "er:cur-7")
    const leg = data.createTransaction("person", {
      accountId: savings,
      date: "2026-10-12",
      amount: 4_000,
    })
    data.linkTransfers("person", [[bank.id, leg.id]])
    data.updateTransaction("person", leg.id, {
      date: "2026-10-13",
      notes: "typed",
      status: "pending",
    })
    expect(row(current, "er:cur-7")).toMatchObject({
      date: "2026-10-12",
      notes: "",
      status: "cleared",
    })
  })
})
