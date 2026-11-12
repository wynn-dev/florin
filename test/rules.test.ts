// Rules: the engine (order, override, captures, the three texts), where its
// category stands against an explicit one and the payee's default, applying
// to existing transactions, and what deleting a category does to rules.
import { DatabaseSync } from "node:sqlite"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import { db, schema } from "@/server/db"
import * as data from "@/server/data"

const home = useTempHome()

function categoryId(name: string): number {
  for (const g of data.listCategoryGroups()) {
    const c = g.categories.find((x) => x.name === name)
    if (c) return c.id
  }
  throw new Error(`no category ${name}`)
}

let n = 0
function account() {
  return data.createAccount("person", {
    name: `Current ${++n}`,
    type: "checking",
  }).id
}

/** Imports one row and answers the transaction it became. */
function importOne(
  accountId: number,
  row: { payee: string; notes?: string; categoryId?: number }
) {
  const { change } = data.importTransactions("bank-sync:Test", accountId, [
    { date: "2026-03-02", amount: -1_250, ...row },
  ])
  return data.listTransactions({ accountId, change }).items[0]
}

const APPLE_PAY = "BEA, Apple Pay"
const NOTES = "BEA, Apple Pay Corner Shop 12 NR:AB123, 01.02.26/10:00"

beforeEach(() => {
  db().delete(schema.rules).run()
})

describe("on import", () => {
  test("a generic extraction rule, then a name rule that sees its result", () => {
    data.saveRules("person", [
      { pattern: String.raw`^BEA, [^,]*?Pay\s+(.+?)\s+NR:`, payee: "$1" },
      {
        pattern: String.raw`^corner shop \d`,
        payee: "Corner Shop",
        categoryId: categoryId("Groceries"),
      },
    ])
    const t = importOne(account(), { payee: APPLE_PAY, notes: NOTES })
    expect(t).toMatchObject({
      payeeName: "Corner Shop",
      categoryName: "Groceries",
      importedPayee: APPLE_PAY,
    })
    // The bank's own name, always replaced, never became a payee.
    expect(data.listPayees({ search: "Apple Pay" }).total).toBe(0)
    // The Activity line says the final payee.
    expect(
      data.listActivityEntries({ entry: undefined }).items[0].summary
    ).toMatch(/at Corner Shop in/)
  })

  test("captures are trimmed and their spaces collapsed", () => {
    data.saveRules("person", [
      {
        pattern: String.raw`^pay to\s+(.*?)\s*ref (\w+)`,
        payee: " $1   ($2) ",
      },
    ])
    const t = importOne(account(), { payee: "PAY TO  Bakery   Lune  REF X12" })
    expect(t.payeeName).toBe("Bakery Lune (X12)")
  })

  test("a later matching rule overrides an earlier one; case doesn't matter", () => {
    data.saveRules("person", [
      { pattern: "lidl", payee: "Lidl", categoryId: categoryId("Groceries") },
      { pattern: "LIDL.*NON[- ]FOOD", categoryId: categoryId("Shopping") },
    ])
    const a = account()
    expect(importOne(a, { payee: "Lidl 0421 non-food" })).toMatchObject({
      payeeName: "Lidl",
      categoryName: "Shopping",
    })
    expect(importOne(a, { payee: "LIDL 0421" })).toMatchObject({
      payeeName: "Lidl",
      categoryName: "Groceries",
    })
  })

  test("a rule is tested on the bank text, the notes and the payee as it stands", () => {
    const transport = categoryId("Transport")
    data.saveRules("person", [
      { pattern: "^ns reizen", categoryId: transport }, // bank text
      { pattern: "ov-chipkaart", payee: "NS" }, // notes
      { pattern: "^NS$", categoryId: transport }, // the name set just before
    ])
    const a = account()
    expect(importOne(a, { payee: "NS REIZEN 22" }).categoryName).toBe(
      "Transport"
    )
    expect(
      importOne(a, { payee: "Card 1234", notes: "OV-chipkaart top-up" })
    ).toMatchObject({ payeeName: "NS", categoryName: "Transport" })
    // A name that only equals "NS" after cleaning: "ns" is not all caps, kept.
    expect(importOne(a, { payee: "Other" }).categoryName).toBeNull()
  })

  test("an explicit category wins; the payee's default is the fallback", () => {
    const groceries = categoryId("Groceries")
    const dining = categoryId("Dining out")
    const a = account()
    const first = importOne(a, { payee: "Cafe Noord" })
    data.setPayeeCategory("person", first.payeeId!, dining)
    data.saveRules("person", [
      { pattern: "^ah \\d", payee: "Albert Heijn", categoryId: groceries },
    ])
    expect(
      importOne(a, { payee: "AH 1234", categoryId: dining }).categoryName
    ).toBe("Dining out")
    expect(importOne(a, { payee: "Cafe Noord" }).categoryName).toBe(
      "Dining out"
    )
  })
})

describe("saving rules", () => {
  test("an invalid or too long pattern is refused, naming the rule; all or none", () => {
    expect(() =>
      data.saveRules("person", [
        { pattern: "ok", payee: "Ok" },
        { pattern: "(unclosed", payee: "X" },
      ])
    ).toThrow(
      /item 2 of 2: rule \/\(unclosed\/ has a pattern that is not a valid regular expression/
    )
    expect(data.listRules()).toEqual([])
    expect(() =>
      data.saveRules("person", [{ pattern: "a".repeat(501), payee: "A" }])
    ).toThrow(/longer than 500/)
    expect(() => data.saveRules("person", [{ pattern: "x" }])).toThrow(
      /sets nothing/
    )
  })

  test("new rules go last unless given a position; a position moves a rule", () => {
    const [a, b] = data.saveRules("person", [
      { pattern: "a", payee: "A" },
      { pattern: "b", payee: "B" },
    ])
    data.saveRules("person", [
      { pattern: "c", payee: "C" },
      { pattern: "first", payee: "First", position: 1 },
    ])
    expect(data.listRules().map((r) => r.pattern)).toEqual([
      "first",
      "a",
      "b",
      "c",
    ])
    const after = data.saveRules("person", [
      { id: b.id, position: 1 },
      { id: a.id, payee: null, categoryId: categoryId("Groceries") },
    ])
    expect(after.map((r) => [r.position, r.pattern])).toEqual([
      [1, "b"],
      [2, "first"],
      [3, "a"],
      [4, "c"],
    ])
    expect(after[2]).toMatchObject({ payee: null, categoryName: "Groceries" })
    const log = data.listActivity({ limit: 2 }).items.map((c) => c.summary)
    expect(log).toEqual([
      "Changed rule /a/ → Groceries: payee → none, category → Groceries",
      "Changed rule /b/ → B: moved to position 1",
    ])
  })

  test("deleting rules is all or none", () => {
    const [a] = data.saveRules("person", [{ pattern: "a", payee: "A" }])
    expect(() => data.deleteRules("person", [a.id, 999_999])).toThrow(
      /rule 999999 not found/
    )
    data.deleteRules("person", [a.id])
    expect(data.listRules()).toEqual([])
  })

  test("a deleted category: rules follow moveTo, or lose it and go if they set nothing", () => {
    const group = data.createCategoryGroup("person", { name: "Temp" })
    const old = data.createCategory("person", {
      groupId: group.id,
      name: "Old",
    })
    const other = data.createCategory("person", {
      groupId: group.id,
      name: "Other",
    })
    data.saveRules("person", [
      { pattern: "moves", categoryId: old.id },
      { pattern: "named", payee: "Named", categoryId: other.id },
      { pattern: "only", categoryId: other.id },
    ])
    data.deleteCategory("person", old.id, categoryId("Shopping"))
    data.deleteCategory("person", other.id)
    expect(
      data.listRules().map((r) => [r.pattern, r.payee, r.categoryName])
    ).toEqual([
      ["moves", null, "Shopping"],
      ["named", "Named", null],
    ])
  })

  test("rules are in the database export", () => {
    data.saveRules("person", [{ pattern: "export", payee: "Exported" }])
    const file = join(home.dir, "copy.db")
    writeFileSync(file, data.databaseCopy())
    const copy = new DatabaseSync(file)
    expect(copy.prepare("select pattern, payee from rules").all()).toEqual([
      { pattern: "export", payee: "Exported" },
    ])
    copy.close()
  })
})

describe("applying to existing transactions", () => {
  const groceries = () => categoryId("Groceries")

  function existing() {
    const a = account()
    data.importTransactions("import", a, [
      { date: "2026-04-01", amount: -500, payee: "JUMBO 0042" }, // untouched
      {
        date: "2026-04-02",
        amount: -600,
        payee: "JUMBO 0042",
        importedId: "2",
      }, // renamed by hand
      { date: "2026-04-03", amount: -700, payee: "Jumbo Markt 7" }, // categorised by hand
    ])
    const [third, second] = data.listTransactions({ accountId: a }).items
    data.updateTransaction("person", second.id, { payeeName: "My Jumbo" })
    data.updateTransaction("person", third.id, {
      categoryId: categoryId("Dining out"),
    })
    // A transfer whose memo would match.
    const savings = account()
    data.createTransaction("person", {
      accountId: a,
      date: "2026-04-04",
      amount: -1000,
      transferAccountId: savings,
      notes: "jumbo savings",
    })
    data.saveRules("person", [
      { pattern: "jumbo", payee: "Jumbo", categoryId: groceries() },
    ])
    return a
  }

  test("by default only what is untouched; a dry run writes nothing", () => {
    const a = existing()
    const before = data.listTransactions({ accountId: a }).items
    const dry = data.applyRules("mcp:test", { accountId: a, dryRun: true })
    expect(dry).toMatchObject({
      checked: 3,
      matched: 3,
      changed: 3,
      payeesSet: 2,
      categoriesSet: 2,
      payeesRemoved: 2, // "Jumbo 0042" and "Jumbo Markt 7" keep none
    })
    expect(dry.change).toBeUndefined()
    expect(dry.sample).toHaveLength(3)
    expect(data.listTransactions({ accountId: a }).items).toEqual(before)

    const done = data.applyRules("mcp:test", { accountId: a })
    expect(done).toMatchObject({ changed: 3, payeesRemoved: 2 })
    const rows = data.listTransactions({ accountId: a }).items
    const byDate = (d: string) => rows.find((t) => t.date === d)!
    expect(byDate("2026-04-01")).toMatchObject({
      payeeName: "Jumbo",
      categoryName: "Groceries",
    })
    expect(byDate("2026-04-02")).toMatchObject({
      payeeName: "My Jumbo",
      categoryName: "Groceries",
    })
    expect(byDate("2026-04-03")).toMatchObject({
      payeeName: "Jumbo",
      categoryName: "Dining out",
    })
    expect(byDate("2026-04-04")).toMatchObject({
      categoryId: null,
      payeeId: null,
    })
    // One Activity entry for the run, each transaction in it.
    const entry = data.getActivityEntry(done.change!)
    expect(entry).toMatchObject({ actor: "mcp:test", transactions: 3 })
    expect(entry.summary).toBe("changed 3 transactions and deleted 2 payees")
    expect(
      data.listPayees({ search: "Jumbo" }).items.map((p) => p.name)
    ).toEqual(["Jumbo", "My Jumbo"])
    // Nothing is left to do.
    expect(data.applyRules("mcp:test", { accountId: a }).changed).toBe(0)
  })

  test("a payee the rules gave counts as untouched, so a later name rule renames it", () => {
    data.saveRules("person", [
      { pattern: String.raw`^BEA, [^,]*?Pay\s+(.+?)\s+NR:`, payee: "$1" },
    ])
    const a = account()
    const t = importOne(a, {
      payee: "BEA, Apple Pay",
      notes: "BEA, Apple Pay JUMBO 1234 AMSTERDAM NR:XY12, 03.02.26/12:00",
    })
    expect(t.payeeName).toBe("JUMBO 1234 AMSTERDAM")
    data.saveRules("person", [
      { pattern: String.raw`^jumbo \d`, payee: "Jumbo" },
    ])
    expect(
      data.applyRules("person", { accountId: a, dryRun: true })
    ).toMatchObject({ changed: 1, payeesSet: 1 })
    data.applyRules("person", { accountId: a })
    expect(data.getTransaction(t.id).payeeName).toBe("Jumbo")
    // A name given by hand stays.
    data.updateTransaction("person", t.id, { payeeName: "Jumbo Centrum" })
    expect(data.applyRules("person", { accountId: a }).changed).toBe(0)
  })

  test("a payee typed on a transaction entered by hand stays", () => {
    const a = account()
    const t = data.createTransaction("person", {
      accountId: a,
      date: "2026-04-05",
      amount: -800,
      payeeName: "Jumbo Centrum",
    })
    data.saveRules("person", [{ pattern: "jumbo", payee: "Jumbo" }])
    expect(
      data.applyRules("person", { accountId: a, dryRun: true })
    ).toMatchObject({ matched: 1, changed: 0, payeesRemoved: 0 })
    data.applyRules("person", { accountId: a })
    expect(data.getTransaction(t.id).payeeName).toBe("Jumbo Centrum")
    expect(data.listPayees({ search: "Jumbo Centrum" }).total).toBe(1)
  })

  test("overwrite sets payee and category wherever a rule matches", () => {
    const a = existing()
    const done = data.applyRules("person", { accountId: a, overwrite: true })
    expect(done).toMatchObject({ checked: 3, changed: 3 })
    const rows = data.listTransactions({ accountId: a }).items
    expect(
      rows
        .filter((t) => !t.transferId)
        .map((t) => [t.payeeName, t.categoryName])
    ).toEqual([
      ["Jumbo", "Groceries"],
      ["Jumbo", "Groceries"],
      ["Jumbo", "Groceries"],
    ])
  })

  test("limited to ids, or to a date range", () => {
    const a = existing()
    const [, , first] = data
      .listTransactions({ accountId: a })
      .items.filter((t) => !t.transferId)
    expect(
      data.applyRules("person", { ids: [first.id], dryRun: true }).checked
    ).toBe(1)
    expect(
      data.applyRules("person", {
        accountId: a,
        from: "2026-04-02",
        to: "2026-04-02",
        dryRun: true,
      }).checked
    ).toBe(1)
  })

  test("a payee with a default category is kept", () => {
    const a = account()
    data.importTransactions("import", a, [
      { date: "2026-05-01", amount: -100, payee: "Kiosk 9" },
    ])
    const [t] = data.listTransactions({ accountId: a }).items
    data.setPayeeCategory("person", t.payeeId!, categoryId("Shopping"))
    data.saveRules("person", [{ pattern: "^kiosk \\d", payee: "Kiosk" }])
    expect(data.applyRules("person", { accountId: a })).toMatchObject({
      changed: 1,
      payeesRemoved: 0,
    })
    expect(data.listPayees({ search: "Kiosk 9" }).total).toBe(1)
  })
})

describe("testing one rule", () => {
  test("counts what it matches and gives a few examples", () => {
    const a = account()
    data.importTransactions("import", a, [
      {
        date: "2026-06-01",
        amount: -100,
        payee: "BEA, Google Pay",
        notes: "BEA, Google Pay Tea House 3 NR:CD456, 01.06.26/09:00",
      },
      { date: "2026-06-02", amount: -100, payee: "Bakery Lune" },
    ])
    expect(
      data.testRule({
        pattern: String.raw`Google Pay\s+(.+?)\s+NR:`,
        payee: "$1",
      })
    ).toEqual({
      matches: 1,
      examples: [{ bankText: "BEA, Google Pay", payee: "Tea House 3" }],
    })
    expect(() => data.testRule({ pattern: "[" })).toThrow(/not a valid/)
  })
})

describe("deleting payees", () => {
  test("all or none; transactions keep the rest", () => {
    const a = account()
    data.importTransactions("import", a, [
      {
        date: "2026-07-01",
        amount: -100,
        payee: "Gone Shop",
        categoryId: categoryId("Shopping"),
      },
    ])
    const [t] = data.listTransactions({ accountId: a }).items
    expect(() => data.deletePayees("person", [t.payeeId!, 999_999])).toThrow(
      /payee 999999 not found/
    )
    expect(data.getPayee(t.payeeId!).name).toBe("Gone Shop")
    data.deletePayees("person", [t.payeeId!])
    expect(data.getTransaction(t.id)).toMatchObject({
      payeeId: null,
      categoryName: "Shopping",
      importedPayee: "Gone Shop",
    })
  })
})
