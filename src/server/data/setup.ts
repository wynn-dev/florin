// First-run setup: what still applies, and the starter categories.
import { and, eq, isNotNull, sql } from "drizzle-orm"
import { db, schema } from "../db"
import { needsSetup } from "../auth"
import { logChange } from "./changes"
import { getSettings, hasTransactions } from "./settings"
import { checkList, checkName, checkObject, InvalidInput } from "./validate"
import type { Actor } from "@/shared/types"
import type { SetupStatus, StarterCategories } from "@/shared/setup"

const {
  accounts,
  budgets,
  categories,
  categoryGroups,
  mcpTokens,
  transactions,
} = schema

function count(table: typeof accounts | typeof mcpTokens, where?: unknown) {
  return db()
    .select({ n: sql<number>`count(*)` })
    .from(table)
    .where(where as never)
    .get()!.n
}

/**
 * The starter categories can be replaced while nothing is budgeted and no
 * transaction is in a category outside the income group (starting balances
 * are, so adding accounts first is fine).
 */
function categoriesReplaceable(): boolean {
  const budgeted = db()
    .select({ n: sql<number>`count(*)` })
    .from(budgets)
    .where(sql`${budgets.amount} != 0`)
    .get()!.n
  if (budgeted) return false
  const used = db()
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(
      and(
        isNotNull(transactions.categoryId),
        eq(categoryGroups.isIncome, false)
      )
    )
    .limit(1)
    .get()
  return !used
}

export function setupStatus(): SetupStatus {
  return {
    needsSetup: needsSetup(),
    currency: getSettings().currency,
    currencyFixed: hasTransactions(),
    accounts: count(accounts, eq(accounts.closed, false)),
    categoriesReplaceable: categoriesReplaceable(),
    mcpTokens: count(mcpTokens),
  }
}

/**
 * Replaces every spending group (the income group stays) with `groups`, in
 * order; an empty list starts empty. Only while categoriesReplaceable().
 */
export function applyStarterCategories(
  actor: Actor,
  input: StarterCategories
): void {
  checkObject(input, "the starter categories")
  const groups = checkList(input.groups, "groups").map((g, i) => {
    checkObject(g, `group ${i + 1}`)
    const names = checkList(g.categories, `${g.name} categories`).map((c) =>
      checkName(c, "category name")
    )
    const lower = names.map((n) => n.toLowerCase())
    const twice = names.find((_, j) => lower.indexOf(lower[j]) !== j)
    if (twice) throw new InvalidInput(`${twice} is in ${g.name} twice`)
    return { name: checkName(g.name, "group name"), categories: names }
  })
  if (!categoriesReplaceable())
    throw new InvalidInput(
      "categories are already in use; change them on the Budget page instead"
    )
  db().transaction((tx) => {
    tx.delete(categoryGroups).where(eq(categoryGroups.isIncome, false)).run()
    const last =
      tx
        .select({
          n: sql<number>`coalesce(max(${categoryGroups.sortOrder}), 0)`,
        })
        .from(categoryGroups)
        .get()?.n ?? 0
    groups.forEach((g, i) => {
      const group = tx
        .insert(categoryGroups)
        .values({ name: g.name, sortOrder: last + i + 1 })
        .returning({ id: categoryGroups.id })
        .get()
      if (g.categories.length)
        tx.insert(categories)
          .values(
            g.categories.map((name, j) => ({
              groupId: group.id,
              name,
              sortOrder: j + 1,
            }))
          )
          .run()
    })
    const n = groups.reduce((sum, g) => sum + g.categories.length, 0)
    logChange(tx, actor, {
      action: "create",
      entity: "category group",
      summary: n
        ? `Started with ${n} categories in ${groups.length} groups`
        : "Started with no categories",
    })
  })
}
