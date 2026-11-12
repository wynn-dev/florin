import { asc, eq, sql } from "drizzle-orm"
import { db, schema } from "../db"
import { logChange } from "./changes"
import { getCategory } from "./categories"
import { checkName, found, InvalidInput } from "./validate"
import type { Database } from "../db"
import type { Actor, Page, Payee } from "@/shared/types"

const { payees, transactions } = schema

const transactionCount = sql<number>`(select count(*) from ${transactions} where ${transactions.payeeId} = ${payees.id})`
const columns = {
  id: payees.id,
  name: payees.name,
  transactionCount,
  defaultCategoryId: payees.defaultCategoryId,
}

/** Payees by name, optionally only those whose name contains `search`. */
export function listPayees(
  options: { search?: string; limit?: number; offset?: number } = {}
): Page<Payee> {
  const where = options.search?.trim()
    ? sql`${payees.name} like ${"%" + options.search.trim() + "%"}`
    : undefined
  const items = db()
    .select(columns)
    .from(payees)
    .where(where)
    .orderBy(asc(sql`lower(${payees.name})`))
    .limit(Math.min(Math.max(options.limit ?? 500, 1), 1000))
    .offset(Math.max(options.offset ?? 0, 0))
    .all()
  const total = db()
    .select({ n: sql<number>`count(*)` })
    .from(payees)
    .where(where)
    .get()!.n
  return { items, total }
}

export function getPayee(id: number): Payee {
  return found(
    db().select(columns).from(payees).where(eq(payees.id, id)).get(),
    `payee ${id}`
  )
}

/** The payee with this name (case-insensitive), created if it doesn't exist. */
export function payeeIdForName(
  name: string,
  tx: Pick<Database, "select" | "insert"> = db()
): number {
  const clean = checkName(name, "payee")
  const existing = tx
    .select({ id: payees.id })
    .from(payees)
    .where(sql`lower(${payees.name}) = lower(${clean})`)
    .get()
  if (existing) return existing.id
  return tx
    .insert(payees)
    .values({ name: clean })
    .returning({ id: payees.id })
    .get().id
}

export function createPayee(actor: Actor, name: string): Payee {
  const id = db().transaction((tx) => {
    const payeeId = payeeIdForName(name, tx)
    logChange(tx, actor, {
      action: "create",
      entity: "payee",
      entityId: payeeId,
      summary: `Added payee ${name.trim()}`,
    })
    return payeeId
  })
  return getPayee(id)
}

export function renamePayee(actor: Actor, id: number, name: string): Payee {
  const clean = checkName(name)
  const payee = getPayee(id)
  const clash = db()
    .select({ id: payees.id })
    .from(payees)
    .where(
      sql`lower(${payees.name}) = lower(${clean}) and ${payees.id} != ${id}`
    )
    .get()
  if (clash) throw new InvalidInput(`a payee named ${clean} already exists`)
  db().transaction((tx) => {
    tx.update(payees).set({ name: clean }).where(eq(payees.id, id)).run()
    logChange(tx, actor, {
      action: "update",
      entity: "payee",
      entityId: id,
      summary: `Renamed payee ${payee.name} to ${clean}`,
    })
  })
  return getPayee(id)
}

/**
 * Sets the category new transactions from this payee get when they arrive
 * without one (from a bank, a file or an agent); null clears it.
 */
export function setPayeeCategory(
  actor: Actor,
  id: number,
  categoryId: number | null
): Payee {
  const payee = getPayee(id)
  const category = categoryId === null ? null : getCategory(categoryId)
  db().transaction((tx) => {
    tx.update(payees)
      .set({ defaultCategoryId: category?.id ?? null })
      .where(eq(payees.id, id))
      .run()
    logChange(tx, actor, {
      action: "update",
      entity: "payee",
      entityId: id,
      summary: category
        ? `Set ${payee.name}'s default category to ${category.name}`
        : `Cleared ${payee.name}'s default category`,
    })
  })
  return getPayee(id)
}

/** The default category of the payee with this id, if it has one. */
export function payeeCategory(
  payeeId: number | null | undefined,
  tx: Pick<Database, "select"> = db()
): number | null {
  if (payeeId === null || payeeId === undefined) return null
  return (
    tx
      .select({ id: payees.defaultCategoryId })
      .from(payees)
      .where(eq(payees.id, payeeId))
      .get()?.id ?? null
  )
}

/** Deletes a payee; its transactions keep their data but lose the payee. */
export function deletePayee(actor: Actor, id: number): void {
  const payee = getPayee(id)
  db().transaction((tx) => {
    tx.delete(payees).where(eq(payees.id, id)).run()
    logChange(tx, actor, {
      action: "delete",
      entity: "payee",
      entityId: id,
      summary: `Deleted payee ${payee.name}`,
    })
  })
}

/** Moves every transaction of `fromIds` onto `intoId` and deletes the merged payees. */
export function mergePayees(
  actor: Actor,
  intoId: number,
  fromIds: number[]
): Payee {
  const into = getPayee(intoId)
  const merged = fromIds.filter((id) => id !== intoId).map(getPayee)
  db().transaction((tx) => {
    for (const { id } of merged) {
      tx.update(transactions)
        .set({ payeeId: intoId })
        .where(eq(transactions.payeeId, id))
        .run()
      tx.delete(payees).where(eq(payees.id, id)).run()
    }
    logChange(tx, actor, {
      action: "update",
      entity: "payee",
      entityId: intoId,
      summary: `Merged ${merged.map((p) => p.name).join(", ")} into ${into.name}`,
    })
  })
  return getPayee(intoId)
}
