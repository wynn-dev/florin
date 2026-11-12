import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import { db, schema } from "../db"
import { getAccount } from "./accounts"
import { getCategory } from "./categories"
import { logChange, money } from "./changes"
import { minorDigits } from "./fx"
import { payeeCategory, payeeIdForName } from "./payees"
import {
  checkAmount,
  checkDate,
  checkList,
  checkObject,
  found,
  InvalidInput,
} from "./validate"
import type { SQL } from "drizzle-orm"
import type { Database } from "../db"
import type {
  Actor,
  NewTransaction,
  Transaction,
  TransactionFilter,
  TransactionPage,
  TransactionPatch,
} from "@/shared/types"

const { transactions, accounts, payees, categories, changes, deletedImports } =
  schema

/** Ids florin gives bank rows (Enable Banking); a deleted one is remembered so a sync doesn't add it back. */
export const BANK_ROW_ID = /^(er|h|pend):/
const transferLeg = alias(transactions, "transfer_leg")
const transferAccount = alias(accounts, "transfer_account")

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0]

function selectTransactions(
  tx: Pick<Database, "select"> = db(),
  withBalance = false
) {
  return tx
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      accountName: accounts.name,
      date: transactions.date,
      amount: transactions.amount,
      payeeId: transactions.payeeId,
      payeeName: payees.name,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      notes: transactions.notes,
      status: transactions.status,
      transferId: transactions.transferId,
      transferAccountId: transferLeg.accountId,
      transferAccountName: transferAccount.name,
      importedId: transactions.importedId,
      importedPayee: transactions.importedPayee,
      bookedDate: transactions.bookedDate,
      transferAmount: transferLeg.amount,
      ...(withBalance
        ? {
            // The account's balance after this row, in the list's own order (date, then id).
            balance: sql<number>`(select sum(b.amount) from ${transactions} b where b.account_id = ${transactions.accountId} and (b.date < ${transactions.date} or (b.date = ${transactions.date} and b.id <= ${transactions.id})))`,
          }
        : {}),
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(payees, eq(transactions.payeeId, payees.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(transferLeg, eq(transactions.transferId, transferLeg.id))
    .leftJoin(transferAccount, eq(transferLeg.accountId, transferAccount.id))
}

function filterConditions(f: TransactionFilter): SQL | undefined {
  const where: (SQL | undefined)[] = []
  if (f.accountId !== undefined)
    where.push(eq(transactions.accountId, f.accountId))
  if (f.categoryId !== undefined)
    where.push(eq(transactions.categoryId, f.categoryId))
  if (f.categoryIds?.length)
    where.push(inArray(transactions.categoryId, f.categoryIds))
  if (f.change !== undefined)
    where.push(
      inArray(
        transactions.id,
        db()
          .select({ id: changes.entityId })
          .from(changes)
          .where(
            and(eq(changes.batch, f.change), eq(changes.entity, "transaction"))
          )
      )
    )
  if (f.payeeId !== undefined) where.push(eq(transactions.payeeId, f.payeeId))
  if (f.status !== undefined) where.push(eq(transactions.status, f.status))
  // Tracking accounts are outside the budget, so their transactions need no category.
  if (f.uncategorized)
    where.push(
      isNull(transactions.categoryId),
      isNull(transactions.transferId),
      eq(accounts.onBudget, true)
    )
  if (f.from !== undefined)
    where.push(gte(transactions.date, checkDate(f.from, "from")))
  if (f.to !== undefined)
    where.push(lte(transactions.date, checkDate(f.to, "to")))
  if (f.minAmount !== undefined)
    where.push(gte(transactions.amount, checkAmount(f.minAmount, "minAmount")))
  if (f.maxAmount !== undefined)
    where.push(lte(transactions.amount, checkAmount(f.maxAmount, "maxAmount")))
  if (f.search?.trim()) {
    const term = `%${f.search.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%`
    where.push(
      or(
        sql`${payees.name} like ${term} escape '\\'`,
        sql`${transactions.notes} like ${term} escape '\\'`,
        sql`${transactions.importedPayee} like ${term} escape '\\'`,
        sql`${categories.name} like ${term} escape '\\'`,
        amountMatch(f.search.trim())
      )
    )
  }
  return and(...where)
}

/**
 * A search that reads as an amount ("42.10", "42,10", "1200") matches it
 * either way round, in each account's own currency: "1200" is ¥1,200 in a
 * JPY account and €1,200.00 in a EUR one; "12.50" matches no JPY row.
 */
function amountMatch(term: string): SQL | undefined {
  const match = /^[+\-−]?(\d+)(?:[.,](\d{1,3}))?$/.exec(term)
  if (!match) return undefined
  const [, whole, fraction = ""] = match
  const currencies = db()
    .selectDistinct({ currency: accounts.currency })
    .from(accounts)
    .all()
    .map((a) => a.currency)
  const byCurrency = currencies.flatMap((currency) => {
    const digits = minorDigits(currency)
    if (fraction.replace(/0+$/, "").length > digits) return []
    const minor = Number(whole + fraction.padEnd(digits, "0").slice(0, digits))
    if (!Number.isSafeInteger(minor)) return []
    return [
      sql`(${accounts.currency} = ${currency} and abs(${transactions.amount}) = ${minor})`,
    ]
  })
  return byCurrency.length ? or(...byCurrency) : undefined
}

/**
 * Transactions matching the filter, newest first, with the total count and
 * sum for paging. Listing one account adds each row's running balance.
 */
export function listTransactions(
  filter: TransactionFilter = {}
): TransactionPage {
  const where = filterConditions(filter)
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000)
  const offset = Math.max(filter.offset ?? 0, 0)
  const items = selectTransactions(db(), filter.accountId !== undefined)
    .where(where)
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(limit)
    .offset(offset)
    .all()
  const sums = db()
    .select({
      currency: accounts.currency,
      n: sql<number>`count(*)`,
      amount: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(payees, eq(transactions.payeeId, payees.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where)
    .groupBy(accounts.currency)
    .orderBy(desc(sql`count(*)`))
    .all()
  return {
    items,
    total: sums.reduce((n, s) => n + s.n, 0),
    sums: sums.map(({ currency, amount }) => ({ currency, amount })),
  }
}

export function getTransaction(
  id: number,
  tx?: Pick<Database, "select">
): Transaction {
  return found(
    selectTransactions(tx).where(eq(transactions.id, id)).get(),
    `transaction ${id}`
  )
}

function resolvePayee(
  tx: Tx,
  input: { payeeId?: number | null; payeeName?: string | null }
): number | null | undefined {
  if (input.payeeName?.trim()) return payeeIdForName(input.payeeName, tx)
  if (input.payeeId === null || input.payeeName === null) return null
  if (input.payeeId !== undefined) {
    found(
      tx
        .select({ id: payees.id })
        .from(payees)
        .where(eq(payees.id, input.payeeId))
        .get(),
      `payee ${input.payeeId}`
    )
    return input.payeeId
  }
  return undefined
}

function checkCategory(
  categoryId: number | null | undefined
): number | null | undefined {
  if (categoryId === undefined || categoryId === null) return categoryId
  return getCategory(categoryId).id
}

/** "−€42.50 at Lidl in Current account on 2026-03-02" */
function describeTransaction(t: Transaction): string {
  const where = t.transferAccountName
    ? `from ${t.accountName} to ${t.transferAccountName}`
    : `${t.payeeName ? `at ${t.payeeName} ` : ""}in ${t.accountName}`
  return `${money(t.amount, getAccount(t.accountId).currency)} ${where} on ${t.date}`
}

function insertTransaction(tx: Tx, input: NewTransaction): number {
  checkObject(input, "a transaction")
  getAccount(input.accountId)
  const date = checkDate(input.date)
  const amount = checkAmount(input.amount)
  const categoryId = checkCategory(input.categoryId) ?? null
  const isTransfer =
    input.transferAccountId !== undefined && input.transferAccountId !== null
  if (isTransfer) {
    if (input.transferAccountId === input.accountId)
      throw new InvalidInput("a transfer needs two different accounts")
    if (
      getAccount(input.transferAccountId!).currency !==
        getAccount(input.accountId).currency &&
      input.transferAmount === undefined
    ) {
      throw new InvalidInput(
        "a transfer between currencies needs transferAmount, what arrives in the other account"
      )
    }
  }
  const payeeId = isTransfer ? null : (resolvePayee(tx, input) ?? null)
  const row = tx
    .insert(transactions)
    .values({
      accountId: input.accountId,
      date,
      amount,
      payeeId,
      // No category given: the payee's default, if it has one.
      categoryId:
        input.categoryId === undefined && !isTransfer
          ? payeeCategory(payeeId, tx)
          : categoryId,
      notes: input.notes ?? "",
      status: input.status === "pending" ? "pending" : "cleared",
      importedId: input.importedId || null,
      importedPayee: input.importedPayee || null,
      bookedDate: input.bookedDate ? checkDate(input.bookedDate) : null,
    })
    .returning({ id: transactions.id })
    .get()
  // Putting a deleted bank row back (Undo) lets later syncs see it again.
  if (input.importedId)
    tx.delete(deletedImports)
      .where(
        and(
          eq(deletedImports.accountId, input.accountId),
          eq(deletedImports.importedId, input.importedId)
        )
      )
      .run()
  if (isTransfer)
    addTransferLeg(tx, row.id, input.transferAccountId!, input.transferAmount)
  return row.id
}

export function createTransaction(
  actor: Actor,
  input: NewTransaction
): Transaction {
  return createTransactions(actor, [input])[0]
}

/** Adds several transactions in one database transaction: all of them or none. */
export function createTransactions(
  actor: Actor,
  inputs: NewTransaction[]
): Transaction[] {
  checkList(inputs, "transactions")
  const ids = db().transaction((tx) =>
    inputs.map((input, i) =>
      eachItem(inputs.length, i, () => {
        const id = insertTransaction(tx, input)
        const t = getTransaction(id, tx)
        logChange(tx, actor, {
          action: "create",
          entity: "transaction",
          entityId: id,
          summary: `Added ${describeTransaction(t)}`,
          detail: "Added",
        })
        return id
      })
    )
  )
  return ids.map((id) => getTransaction(id))
}

/** Runs one item of a bulk write; when there are several, an error names the item. */
export function eachItem<T>(count: number, i: number, fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    if (count > 1 && error instanceof Error) {
      const prefix = `item ${i + 1} of ${count}: `
      error.message = prefix + error.message
    }
    throw error
  }
}

/** Creates the mirrored leg of transaction `id` in `accountId` and links the two. */
function addTransferLeg(
  tx: Tx,
  id: number,
  accountId: number,
  amount?: number
) {
  const source = tx
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .get()!
  const leg = tx
    .insert(transactions)
    .values({
      accountId,
      date: source.date,
      amount:
        amount === undefined
          ? -source.amount
          : checkAmount(amount, "transferAmount"),
      notes: source.notes,
      status: source.status,
      transferId: id,
    })
    .returning({ id: transactions.id })
    .get()
  tx.update(transactions)
    .set({ transferId: leg.id, payeeId: null })
    .where(eq(transactions.id, id))
    .run()
}

function applyPatch(tx: Tx, id: number, patch: TransactionPatch): string[] {
  checkObject(patch, "patch")
  const current = getTransaction(id, tx)
  const set: Partial<typeof transactions.$inferInsert> = {}
  if (patch.accountId !== undefined)
    set.accountId = getAccount(patch.accountId).id
  if (patch.date !== undefined) set.date = checkDate(patch.date)
  if (patch.amount !== undefined) set.amount = checkAmount(patch.amount)
  if (patch.notes !== undefined) set.notes = String(patch.notes)
  if (patch.status !== undefined)
    set.status = patch.status === "pending" ? "pending" : "cleared"
  if (patch.categoryId !== undefined)
    set.categoryId = checkCategory(patch.categoryId)
  const transferAccountId =
    patch.transferAccountId === undefined
      ? current.transferAccountId
      : patch.transferAccountId
  if (patch.transferAccountId) getAccount(patch.transferAccountId)
  if (
    transferAccountId !== null &&
    transferAccountId === (set.accountId ?? current.accountId)
  ) {
    throw new InvalidInput("a transfer needs two different accounts")
  }
  // A leg moved (or a transfer made) across currencies can't mirror the
  // amount: what arrives in the other account has to be said.
  const moved =
    set.accountId !== undefined || patch.transferAccountId !== undefined
  if (
    moved &&
    transferAccountId !== null &&
    patch.transferAmount === undefined
  ) {
    const from = getAccount(set.accountId ?? current.accountId).currency
    const to = getAccount(transferAccountId).currency
    const was =
      current.transferAccountId !== null &&
      getAccount(current.accountId).currency === from &&
      getAccount(current.transferAccountId).currency === to
    if (from !== to && !was)
      throw new InvalidInput(
        "a transfer between currencies needs transferAmount, what arrives in the other account"
      )
  }
  const payeeId = resolvePayee(tx, patch)
  if (payeeId !== undefined) set.payeeId = payeeId
  if (Object.keys(set).length)
    tx.update(transactions).set(set).where(eq(transactions.id, id)).run()

  const legId = current.transferId
  if (patch.transferAccountId === null && legId) {
    // No longer a transfer: drop the other leg.
    tx.delete(transactions).where(eq(transactions.id, legId)).run()
    tx.update(transactions)
      .set({ transferId: null })
      .where(eq(transactions.id, id))
      .run()
  } else if (patch.transferAccountId && !legId) {
    addTransferLeg(tx, id, patch.transferAccountId, patch.transferAmount)
  } else if (legId) {
    // Keep the other leg mirrored; across currencies only transferAmount moves its amount.
    const mirror: Partial<typeof transactions.$inferInsert> = {}
    const legAccount = getAccount(
      patch.transferAccountId ?? current.transferAccountId!
    )
    const sameCurrency =
      legAccount.currency ===
      getAccount(set.accountId ?? current.accountId).currency
    if (set.date !== undefined) mirror.date = set.date
    if (patch.transferAmount !== undefined)
      mirror.amount = checkAmount(patch.transferAmount, "transferAmount")
    else if (set.amount !== undefined && sameCurrency)
      mirror.amount = -set.amount
    if (set.notes !== undefined) mirror.notes = set.notes
    if (set.status !== undefined) mirror.status = set.status
    if (patch.transferAccountId) mirror.accountId = patch.transferAccountId
    if (Object.keys(mirror).length)
      tx.update(transactions)
        .set(mirror)
        .where(eq(transactions.id, legId))
        .run()
  }
  return Object.keys(patch)
}

export function updateTransaction(
  actor: Actor,
  id: number,
  patch: TransactionPatch
): Transaction {
  return updateTransactions(actor, [id], patch)[0]
}

/** Applies one change (e.g. a category or payee) to several transactions in one database transaction. */
export function updateTransactions(
  actor: Actor,
  ids: number[],
  patch: TransactionPatch
): Transaction[] {
  checkList(ids, "ids")
  db().transaction((tx) => {
    for (const id of ids) {
      const before = getTransaction(id, tx)
      applyPatch(tx, id, patch)
      logUpdate(tx, actor, before, getTransaction(id, tx))
    }
  })
  return ids.map((id) => getTransaction(id))
}

/**
 * Applies a different change to each transaction (e.g. a category per
 * transaction) in one database transaction: all of them or none.
 */
export function patchTransactions(
  actor: Actor,
  updates: (TransactionPatch & { id: number })[]
): Transaction[] {
  checkList(updates, "updates")
  const ids = db().transaction((tx) =>
    updates.map((update, i) =>
      eachItem(updates.length, i, () => {
        const { id, ...patch } = checkObject(update, "each update")
        if (!Number.isSafeInteger(id))
          throw new InvalidInput("each update needs the transaction's id")
        const before = getTransaction(id, tx)
        applyPatch(tx, id, patch)
        logUpdate(tx, actor, before, getTransaction(id, tx))
        return id
      })
    )
  )
  return ids.map((id) => getTransaction(id))
}

/**
 * Logs what an update changed, compared field by field, so the line says
 * "Category set to Groceries" rather than which fields were sent; an update
 * that changed nothing logs nothing.
 */
function logUpdate(
  tx: Tx,
  actor: Actor,
  before: Transaction,
  after: Transaction
) {
  const currency = (accountId: number) => getAccount(accountId).currency
  const parts: string[] = []
  if (before.categoryId !== after.categoryId)
    parts.push(
      after.categoryName
        ? `category set to ${after.categoryName}`
        : "category cleared"
    )
  if (before.transferAccountId !== after.transferAccountId)
    parts.push(
      after.transferAccountName
        ? `made a transfer to ${after.transferAccountName}`
        : "no longer a transfer"
    )
  if (before.payeeId !== after.payeeId && !after.transferId)
    parts.push(
      after.payeeName ? `payee set to ${after.payeeName}` : "payee cleared"
    )
  if (before.accountId !== after.accountId)
    parts.push(`moved to ${after.accountName}`)
  if (before.date !== after.date) parts.push(`date set to ${after.date}`)
  if (before.amount !== after.amount)
    parts.push(
      `amount set to ${money(after.amount, currency(after.accountId))}`
    )
  if (
    after.transferAmount !== null &&
    before.transferAmount !== after.transferAmount &&
    currency(after.accountId) !== currency(after.transferAccountId!)
  )
    parts.push(
      `received set to ${money(after.transferAmount, currency(after.transferAccountId!))}`
    )
  if (before.notes !== after.notes)
    parts.push(after.notes ? "memo edited" : "memo cleared")
  if (before.status !== after.status) parts.push(`marked ${after.status}`)
  if (!parts.length) return
  const detail = parts.join(", ").replace(/^./, (c) => c.toUpperCase())
  const what = describeTransaction(after)
  logChange(tx, actor, {
    action: "update",
    entity: "transaction",
    entityId: after.id,
    summary:
      parts.length === 1 && parts[0].startsWith("category ")
        ? after.categoryName
          ? `Categorised ${what} as ${after.categoryName}`
          : `Uncategorised ${what}`
        : `Edited ${what}: ${parts.join(", ")}`,
    detail,
  })
}

export function deleteTransaction(actor: Actor, id: number): void {
  deleteTransactions(actor, [id])
}

/** Deletes transactions in one database transaction; deleting either leg of a transfer deletes both. */
export function deleteTransactions(actor: Actor, ids: number[]): void {
  const doomed = checkList(ids, "ids").map((id) => getTransaction(id))
  db().transaction((tx) => {
    for (const t of doomed) {
      tx.delete(transactions).where(eq(transactions.id, t.id)).run()
      if (t.importedId && BANK_ROW_ID.test(t.importedId))
        tx.insert(deletedImports)
          .values({ accountId: t.accountId, importedId: t.importedId })
          .onConflictDoNothing()
          .run()
      if (t.transferId)
        tx.delete(transactions).where(eq(transactions.id, t.transferId)).run()
      logChange(tx, actor, {
        action: "delete",
        entity: "transaction",
        entityId: t.id,
        summary: `Deleted ${describeTransaction(t)}`,
        detail: "Deleted",
      })
    }
  })
}
