import { asc, eq, sql } from "drizzle-orm"
import { STARTING_BALANCES, db, schema } from "../db"
import { describe, logChange } from "./changes"
import { rulesLeaveCategory } from "./rules"
import { checkName, found, InvalidInput } from "./validate"
import type { Database } from "../db"
import type { Actor, Category, CategoryGroup } from "@/shared/types"

const { categoryGroups, categories, transactions, budgets } = schema

export function listCategoryGroups(): CategoryGroup[] {
  const groups = db()
    .select()
    .from(categoryGroups)
    .orderBy(
      asc(categoryGroups.isIncome),
      asc(categoryGroups.sortOrder),
      asc(categoryGroups.id)
    )
    .all()
  const cats = db()
    .select({
      id: categories.id,
      groupId: categories.groupId,
      name: categories.name,
      hidden: categories.hidden,
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.id))
    .all()
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    isIncome: g.isIncome,
    categories: cats.filter((c) => c.groupId === g.id),
  }))
}

export function getCategory(id: number): Category {
  return found(
    db()
      .select({
        id: categories.id,
        groupId: categories.groupId,
        name: categories.name,
        hidden: categories.hidden,
      })
      .from(categories)
      .where(eq(categories.id, id))
      .get(),
    `category ${id}`
  )
}

function getGroup(id: number): CategoryGroup {
  return found(
    listCategoryGroups().find((g) => g.id === id),
    `category group ${id}`
  )
}

export function createCategoryGroup(
  actor: Actor,
  input: { name: string; isIncome?: boolean }
): CategoryGroup {
  const name = checkName(input.name)
  const id = db().transaction((tx) => {
    const row = tx
      .insert(categoryGroups)
      .values({
        name,
        isIncome: Boolean(input.isIncome),
        sortOrder: sql`(select coalesce(max(${categoryGroups.sortOrder}), 0) + 1 from ${categoryGroups})`,
      })
      .returning({ id: categoryGroups.id })
      .get()
    logChange(tx, actor, {
      action: "create",
      entity: "category group",
      entityId: row.id,
      summary: `Added category group ${name}`,
    })
    return row.id
  })
  return getGroup(id)
}

export function renameCategoryGroup(
  actor: Actor,
  id: number,
  name: string
): CategoryGroup {
  const group = getGroup(id)
  const clean = checkName(name)
  db().transaction((tx) => {
    tx.update(categoryGroups)
      .set({ name: clean })
      .where(eq(categoryGroups.id, id))
      .run()
    logChange(tx, actor, {
      action: "update",
      entity: "category group",
      entityId: id,
      summary: `Renamed category group ${group.name} to ${clean}`,
    })
  })
  return getGroup(id)
}

/**
 * Deletes a group with its categories. With `transferTo`, their transactions
 * and budget amounts move to that category first (see deleteCategory);
 * otherwise their transactions become uncategorized.
 */
export function deleteCategoryGroup(
  actor: Actor,
  id: number,
  transferTo?: number
): void {
  const group = getGroup(id)
  const target = transferTo === undefined ? undefined : getCategory(transferTo)
  if (target?.groupId === id)
    throw new InvalidInput(
      `${target.name} is in the group being deleted; pick a category in another group`
    )
  db().transaction((tx) => {
    if (target)
      for (const c of group.categories) moveCategoryData(tx, c.id, target.id)
    for (const c of group.categories)
      rulesLeaveCategory(tx, actor, c.id, target?.id)
    tx.delete(categoryGroups).where(eq(categoryGroups.id, id)).run()
    logChange(tx, actor, {
      action: "delete",
      entity: "category group",
      entityId: id,
      summary:
        `Deleted category group ${group.name}` +
        (target ? `, moving its transactions to ${target.name}` : ""),
    })
  })
}

/** Moves a category's transactions and budget amounts onto another category. */
function moveCategoryData(
  tx: Pick<Database, "select" | "insert" | "update">,
  fromId: number,
  toId: number
) {
  tx.update(transactions)
    .set({ categoryId: toId })
    .where(eq(transactions.categoryId, fromId))
    .run()
  const amounts = tx
    .select()
    .from(budgets)
    .where(eq(budgets.categoryId, fromId))
    .all()
  for (const { month, amount } of amounts) {
    tx.insert(budgets)
      .values({ month, categoryId: toId, amount })
      .onConflictDoUpdate({
        target: [budgets.month, budgets.categoryId],
        set: { amount: sql`${budgets.amount} + ${amount}` },
      })
      .run()
  }
}

export function createCategory(
  actor: Actor,
  input: { groupId: number; name: string }
): Category {
  const group = getGroup(input.groupId)
  const name = checkName(input.name)
  const id = db().transaction((tx) => {
    const row = tx
      .insert(categories)
      .values({
        groupId: input.groupId,
        name,
        sortOrder: sql`(select coalesce(max(${categories.sortOrder}), 0) + 1 from ${categories})`,
      })
      .returning({ id: categories.id })
      .get()
    logChange(tx, actor, {
      action: "create",
      entity: "category",
      entityId: row.id,
      summary: `Added category ${name} to ${group.name}`,
    })
    return row.id
  })
  return getCategory(id)
}

export function updateCategory(
  actor: Actor,
  id: number,
  patch: { name?: string; hidden?: boolean; groupId?: number }
): Category {
  const category = getCategory(id)
  const set: Partial<typeof categories.$inferInsert> = {}
  if (patch.name !== undefined) set.name = checkName(patch.name)
  if (patch.hidden !== undefined) set.hidden = Boolean(patch.hidden)
  if (patch.groupId !== undefined) set.groupId = getGroup(patch.groupId).id
  if (!Object.keys(set).length) return category
  db().transaction((tx) => {
    tx.update(categories).set(set).where(eq(categories.id, id)).run()
    logChange(tx, actor, {
      action: "update",
      entity: "category",
      entityId: id,
      summary: `Changed category ${category.name}: ${describe(set)}`,
    })
  })
  return getCategory(id)
}

/**
 * Deletes a category. With `transferTo`, its transactions and budget amounts
 * move to that category, so what was available carries over there; otherwise
 * its transactions become uncategorized and its budget amounts are dropped.
 */
export function deleteCategory(
  actor: Actor,
  id: number,
  transferTo?: number
): void {
  const category = getCategory(id)
  if (transferTo !== undefined) {
    if (transferTo === id)
      throw new InvalidInput(
        "cannot move transactions to the category being deleted"
      )
    getCategory(transferTo)
  }
  db().transaction((tx) => {
    if (transferTo !== undefined) moveCategoryData(tx, id, transferTo)
    rulesLeaveCategory(tx, actor, id, transferTo)
    tx.delete(categories).where(eq(categories.id, id)).run()
    logChange(tx, actor, {
      action: "delete",
      entity: "category",
      entityId: id,
      summary:
        `Deleted category ${category.name}` +
        (transferTo === undefined
          ? ""
          : `, moving its transactions to ${getCategory(transferTo).name}`),
    })
  })
}

/**
 * The income category opening balances are booked to, found by its key (the
 * person may rename it), created when missing.
 */
export function startingBalanceCategoryId(
  tx: Pick<Database, "select" | "insert"> = db()
): number {
  const existing = tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.key, STARTING_BALANCES))
    .get()
  if (existing) return existing.id
  let group = tx
    .select({ id: categoryGroups.id })
    .from(categoryGroups)
    .where(eq(categoryGroups.isIncome, true))
    .get()
  group ??= tx
    .insert(categoryGroups)
    .values({ name: "Income", isIncome: true })
    .returning({ id: categoryGroups.id })
    .get()
  return tx
    .insert(categories)
    .values({
      groupId: group.id,
      name: "Starting balances",
      key: STARTING_BALANCES,
    })
    .returning({ id: categories.id })
    .get().id
}
