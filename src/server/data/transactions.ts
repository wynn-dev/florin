import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import { db, schema } from "../db"
import { getAccount } from "./accounts"
import { getCategory } from "./categories"
import { logChange, money } from "./changes"
import { payeeIdForName } from "./payees"
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

const { transactions, accounts, payees, categories } = schema
const transferLeg = alias(transactions, "transfer_leg")
const transferAccount = alias(accounts, "transfer_account")

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0]

function selectTransactions(tx: Pick<Database, "select"> = db()) {
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
        sql`${categories.name} like ${term} escape '\\'`
      )
    )
  }
  return and(...where)
}

/** Transactions matching the filter, newest first, with the total count for paging. */
export function listTransactions(
  filter: TransactionFilter = {}
): TransactionPage {
  const where = filterConditions(filter)
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000)
  const offset = Math.max(filter.offset ?? 0, 0)
  const items = selectTransactions()
    .where(where)
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(limit)
    .offset(offset)
    .all()
  const total = db()
    .select({ n: sql<number>`count(*)` })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(payees, eq(transactions.payeeId, payees.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where)
    .get()!.n
  return { items, total }
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
  const row = tx
    .insert(transactions)
    .values({
      accountId: input.accountId,
      date,
      amount,
      payeeId: isTransfer ? null : (resolvePayee(tx, input) ?? null),
      categoryId,
      notes: input.notes ?? "",
      status: input.status === "pending" ? "pending" : "cleared",
    })
    .returning({ id: transactions.id })
    .get()
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
        })
        return id
      })
    )
  )
  return ids.map((id) => getTransaction(id))
}

/** Runs one item of a bulk write; when there are several, an error names the item. */
function eachItem<T>(count: number, i: number, fn: () => T): T {
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
      const fields = applyPatch(tx, id, patch)
      const t = getTransaction(id, tx)
      logChange(tx, actor, {
        action: "update",
        entity: "transaction",
        entityId: id,
        summary: `Changed ${fields.join(", ")} of ${describeTransaction(t)}`,
      })
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
        const fields = applyPatch(tx, id, patch)
        const t = getTransaction(id, tx)
        logChange(tx, actor, {
          action: "update",
          entity: "transaction",
          entityId: id,
          summary: `Changed ${fields.join(", ")} of ${describeTransaction(t)}`,
        })
        return id
      })
    )
  )
  return ids.map((id) => getTransaction(id))
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
      if (t.transferId)
        tx.delete(transactions).where(eq(transactions.id, t.transferId)).run()
      logChange(tx, actor, {
        action: "delete",
        entity: "transaction",
        entityId: t.id,
        summary: `Deleted ${describeTransaction(t)}`,
      })
    }
  })
}
