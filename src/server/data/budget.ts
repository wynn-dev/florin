// Envelope budgeting. Each month the person assigns money to expense
// categories. Per category, month by month from its first month with an
// assignment or a transaction: available = last month's available if it was
// positive + assigned + activity. Leftover carries into the next month;
// overspending shows in its own month and then resets to zero, taken out of
// Ready to assign instead. Money arrives through income categories; "to
// budget" for a month is all income to date minus all amounts assigned to
// date minus the overspending of every earlier month.
import { and, desc, eq, or, sql } from "drizzle-orm"
import { db, schema } from "../db"
import { getCategory, listCategoryGroups } from "./categories"
import { logChange, money } from "./changes"
import { getSettings } from "./settings"
import {
  checkAmount,
  checkList,
  checkMonth,
  checkObject,
  InvalidInput,
  addMonths,
  monthEnd,
  monthsBetween,
} from "./validate"
import type {
  Actor,
  BudgetAmount,
  BudgetGroup,
  BudgetMonth,
} from "@/shared/types"
import type { BudgetCategoryDetail } from "@/shared/budget"

const { budgets, transactions, accounts, changes: changeLog } = schema

/** Per category, per month ("YYYY-MM"): an amount. */
type ByMonth = Map<number, Map<string, number>>

function byMonth(
  rows: { categoryId: number | null; month: string; amount: number }[]
): ByMonth {
  const out: ByMonth = new Map()
  for (const r of rows) {
    if (r.categoryId === null) continue
    const months = out.get(r.categoryId) ?? new Map<string, number>()
    months.set(r.month, r.amount)
    out.set(r.categoryId, months)
  }
  return out
}

/** What was assigned to each category in each month up to `month`. */
function assignedByMonth(month: string): ByMonth {
  return byMonth(
    db()
      .select({
        categoryId: budgets.categoryId,
        month: budgets.month,
        amount: budgets.amount,
      })
      .from(budgets)
      .where(sql`${budgets.month} <= ${month}`)
      .all()
  )
}

/** Each category's activity (on-budget accounts) in each month up to `month`. */
function activityByMonth(month: string): ByMonth {
  const m = sql<string>`substr(${transactions.date}, 1, 7)`
  return byMonth(
    db()
      .select({
        categoryId: transactions.categoryId,
        month: m,
        amount: sql<number>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .innerJoin(
        accounts,
        and(
          eq(transactions.accountId, accounts.id),
          eq(accounts.onBudget, true)
        )
      )
      .where(
        sql`${transactions.date} <= ${monthEnd(month)} and ${transactions.categoryId} is not null`
      )
      .groupBy(transactions.categoryId, m)
      .all()
  )
}

/**
 * One expense category's envelope before `month`: what carries in (last
 * month's available when positive), and as positive amounts last month's
 * overspending and that of every month before `month`, which Ready to
 * assign covers.
 */
function envelope(
  month: string,
  assigned: Map<string, number> | undefined,
  activity: Map<string, number> | undefined,
  /** Adds each earlier month's overspending here, by month. */
  byMonth?: Map<string, number>
): { carried: number; lastMonth: number; overspentBefore: number } {
  const months = [...(assigned?.keys() ?? []), ...(activity?.keys() ?? [])]
  const previous = addMonths(month, -1)
  let available = 0
  let overspentBefore = 0
  let lastMonth = 0
  if (months.length) {
    for (const m of monthsBetween(months.sort()[0], previous)) {
      available =
        Math.max(0, available) +
        (assigned?.get(m) ?? 0) +
        (activity?.get(m) ?? 0)
      const overspent = Math.max(0, -available)
      overspentBefore += overspent
      if (byMonth && overspent)
        byMonth.set(m, (byMonth.get(m) ?? 0) + overspent)
    }
    lastMonth = Math.max(0, -available)
  }
  return { carried: Math.max(0, available), lastMonth, overspentBefore }
}

export function getBudgetMonth(month: string): BudgetMonth {
  checkMonth(month)
  const assigned = assignedByMonth(month)
  const activity = activityByMonth(month)
  const total = (months: Map<string, number> | undefined) =>
    sum([...(months?.values() ?? [])])

  let incomeToDate = 0
  let income = 0
  let assignedToDate = 0
  let overspentBefore = 0
  let lastMonthOverspent = 0
  const groups: BudgetGroup[] = []
  for (const group of listCategoryGroups()) {
    if (group.isIncome) {
      for (const c of group.categories) {
        incomeToDate += total(activity.get(c.id))
        income += activity.get(c.id)?.get(month) ?? 0
      }
      continue
    }
    const categories = group.categories.map((c) => {
      const before = envelope(month, assigned.get(c.id), activity.get(c.id))
      const budgeted = assigned.get(c.id)?.get(month) ?? 0
      const spent = activity.get(c.id)?.get(month) ?? 0
      assignedToDate += total(assigned.get(c.id))
      overspentBefore += before.overspentBefore
      lastMonthOverspent += before.lastMonth
      return {
        id: c.id,
        name: c.name,
        hidden: c.hidden,
        budgeted,
        activity: spent,
        available: before.carried + budgeted + spent,
      }
    })
    groups.push({
      id: group.id,
      name: group.name,
      budgeted: sum(categories.map((c) => c.budgeted)),
      activity: sum(categories.map((c) => c.activity)),
      available: sum(categories.map((c) => c.available)),
      categories,
    })
  }
  const all = groups.flatMap((g) => g.categories)
  return {
    month,
    income,
    budgeted: sum(groups.map((g) => g.budgeted)),
    activity: sum(groups.map((g) => g.activity)),
    available: sum(groups.map((g) => g.available)),
    overspent: sum(all.map((c) => Math.max(0, -c.available))),
    lastMonthOverspent,
    toBudget: incomeToDate - assignedToDate - overspentBefore,
    firstMonth: firstBudgetMonth(),
    groups,
  }
}

/**
 * Every month before `month` with overspending, and how much (positive): what
 * the next month's Ready to assign covers.
 */
export function overspendingByMonth(month: string): Map<string, number> {
  const assigned = assignedByMonth(month)
  const activity = activityByMonth(month)
  const out = new Map<string, number>()
  for (const group of listCategoryGroups()) {
    if (group.isIncome) continue
    for (const c of group.categories)
      envelope(month, assigned.get(c.id), activity.get(c.id), out)
  }
  return out
}

/** Sets the amount assigned to an expense category in a month (0 clears it). */
export function setBudgetAmount(
  actor: Actor,
  month: string,
  categoryId: number,
  amount: number
): BudgetMonth {
  return setBudgetAmounts(actor, month, [{ categoryId, amount }])
}

/** Sets several categories' amounts for a month in one database transaction. */
export function setBudgetAmounts(
  actor: Actor,
  month: string,
  amounts: BudgetAmount[]
): BudgetMonth {
  checkMonth(month)
  const groups = listCategoryGroups()
  const currency = getSettings().currency
  const changes = checkList(amounts, "amounts").map((entry) => {
    const { categoryId, amount } = checkObject(entry, "each amount")
    checkAmount(amount)
    const category = getCategory(categoryId)
    if (groups.find((g) => g.id === category.groupId)!.isIncome) {
      throw new InvalidInput(
        `${category.name} is an income category; income is not budgeted`
      )
    }
    return { category, amount }
  })
  db().transaction((tx) => {
    for (const { category, amount } of changes) {
      if (amount === 0) {
        tx.delete(budgets)
          .where(
            and(eq(budgets.month, month), eq(budgets.categoryId, category.id))
          )
          .run()
      } else {
        tx.insert(budgets)
          .values({ month, categoryId: category.id, amount })
          .onConflictDoUpdate({
            target: [budgets.month, budgets.categoryId],
            set: { amount },
          })
          .run()
      }
      logChange(tx, actor, {
        action: "update",
        entity: "budget",
        entityId: category.id,
        summary: `Budgeted ${money(amount, currency)} for ${category.name} in ${month}`,
      })
    }
  })
  return getBudgetMonth(month)
}

/**
 * Money moved from one category's envelope to another's in a month. A null
 * side is Ready to assign: moving from it assigns more to `to`, moving to it
 * takes money back from `from`.
 */
export type BudgetMove = {
  fromCategoryId: number | null
  toCategoryId: number | null
  amount: number
}

/**
 * Moves money between categories in a month: lowers what is assigned to each
 * `from` category and raises its `to` category by the same amount, so "to
 * budget" is unchanged unless one side is Ready to assign (null). All moves
 * happen together or not at all.
 */
export function moveBudgetAmounts(
  actor: Actor,
  month: string,
  moves: BudgetMove[]
): BudgetMonth {
  checkMonth(month)
  const groups = listCategoryGroups()
  const currency = getSettings().currency
  const expense = (id: unknown, field: string) => {
    if (id === null) return null
    if (!Number.isSafeInteger(id))
      throw new InvalidInput(`${field} must be a category id or null`)
    const category = getCategory(id as number)
    if (groups.find((g) => g.id === category.groupId)!.isIncome)
      throw new InvalidInput(
        `${category.name} is an income category; money moves between expense categories`
      )
    return category
  }
  const checked = checkList(moves, "moves").map((move) => {
    checkObject(move, "each move")
    const from = expense(move.fromCategoryId, "fromCategoryId")
    const to = expense(move.toCategoryId, "toCategoryId")
    if (from?.id === to?.id)
      throw new InvalidInput("a move needs two different categories")
    const amount = checkAmount(move.amount)
    if (amount <= 0)
      throw new InvalidInput(
        "amount must be positive; swap from and to instead"
      )
    return { from, to, amount }
  })
  db().transaction((tx) => {
    const add = (categoryId: number, delta: number) => {
      const current =
        tx
          .select({ amount: budgets.amount })
          .from(budgets)
          .where(
            and(eq(budgets.month, month), eq(budgets.categoryId, categoryId))
          )
          .get()?.amount ?? 0
      const amount = current + delta
      if (amount === 0) {
        tx.delete(budgets)
          .where(
            and(eq(budgets.month, month), eq(budgets.categoryId, categoryId))
          )
          .run()
      } else {
        tx.insert(budgets)
          .values({ month, categoryId, amount })
          .onConflictDoUpdate({
            target: [budgets.month, budgets.categoryId],
            set: { amount },
          })
          .run()
      }
    }
    for (const { from, to, amount } of checked) {
      if (from) add(from.id, -amount)
      if (to) add(to.id, amount)
      logChange(tx, actor, {
        action: "update",
        entity: "budget",
        entityId: (to ?? from)!.id,
        // The category money left: also the entity itself when it went back to Ready to assign.
        relatedId: from ? from.id : null,
        summary: `Moved ${money(amount, currency)} from ${from?.name ?? "Ready to assign"} to ${to?.name ?? "Ready to assign"} in ${month}`,
      })
    }
  })
  return getBudgetMonth(month)
}

/**
 * One category's numbers around a month, for the budget's inspector: what was
 * spent in each of the twelve months up to it and the latest change to its
 * budget, by anyone.
 */
export function getBudgetCategoryDetail(
  month: string,
  categoryId: number
): BudgetCategoryDetail {
  checkMonth(month)
  const category = getCategory(categoryId)
  const from = addMonths(month, -11)
  const rows = db()
    .select({
      month: sql<string>`substr(${transactions.date}, 1, 7)`,
      amount: sql<number>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .innerJoin(
      accounts,
      and(eq(transactions.accountId, accounts.id), eq(accounts.onBudget, true))
    )
    .where(
      and(
        eq(transactions.categoryId, category.id),
        sql`${transactions.date} >= ${from + "-01"} and ${transactions.date} <= ${monthEnd(month)}`
      )
    )
    .groupBy(sql`1`)
    .all()
  const byMonth = new Map(rows.map((r) => [r.month, r.amount]))
  const last = db()
    .select()
    .from(changeLog)
    .where(
      and(
        eq(changeLog.entity, "budget"),
        // A move is logged against the category it went to, with the one
        // it came from as its related id.
        or(
          eq(changeLog.entityId, category.id),
          eq(changeLog.relatedId, category.id)
        )
      )
    )
    .orderBy(desc(changeLog.id))
    .limit(1)
    .get()
  return {
    categoryId: category.id,
    history: monthsBetween(from, month).map((m) => ({
      month: m,
      spent: 0 - (byMonth.get(m) ?? 0),
    })),
    lastChange: last
      ? {
          id: last.id,
          entry: last.batch ?? last.id,
          into: last.relatedId !== category.id,
          at: last.at,
          actor: last.actor as Actor,
          summary: last.summary,
        }
      : null,
  }
}

/** The first month with a transaction in an on-budget account, or null. */
function firstBudgetMonth(): string | null {
  return (
    db()
      .select({ date: sql<string | null>`min(${transactions.date})` })
      .from(transactions)
      .innerJoin(
        accounts,
        and(
          eq(transactions.accountId, accounts.id),
          eq(accounts.onBudget, true)
        )
      )
      .get()
      ?.date?.slice(0, 7) ?? null
  )
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
