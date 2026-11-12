// Envelope budgeting. Each month the person assigns money to expense
// categories. A category's available amount is everything ever assigned to it
// plus everything ever spent from it, up to that month: leftover carries into
// the next month, and so does overspending until it is covered. Money arrives
// through income categories; "to budget" is all income to date minus all
// amounts assigned to date.
import { and, eq, sql } from "drizzle-orm"
import { db, schema } from "../db"
import { getCategory, listCategoryGroups } from "./categories"
import { logChange, money } from "./changes"
import { getSettings } from "./settings"
import { checkAmount, checkMonth, InvalidInput, monthEnd } from "./validate"
import type {
  Actor,
  BudgetAmount,
  BudgetGroup,
  BudgetMonth,
} from "@/shared/types"

const { budgets, transactions, accounts } = schema

type Sums = Map<number, { total: number; month: number }>

function budgetedSums(month: string): Sums {
  const rows = db()
    .select({
      categoryId: budgets.categoryId,
      total: sql<number>`sum(${budgets.amount})`,
      month: sql<number>`sum(case when ${budgets.month} = ${month} then ${budgets.amount} else 0 end)`,
    })
    .from(budgets)
    .where(sql`${budgets.month} <= ${month}`)
    .groupBy(budgets.categoryId)
    .all()
  return new Map(rows.map((r) => [r.categoryId, r]))
}

function activitySums(month: string): Sums {
  const rows = db()
    .select({
      categoryId: transactions.categoryId,
      total: sql<number>`sum(${transactions.amount})`,
      month: sql<number>`sum(case when substr(${transactions.date}, 1, 7) = ${month} then ${transactions.amount} else 0 end)`,
    })
    .from(transactions)
    .innerJoin(
      accounts,
      and(eq(transactions.accountId, accounts.id), eq(accounts.onBudget, true))
    )
    .where(
      sql`${transactions.date} <= ${monthEnd(month)} and ${transactions.categoryId} is not null`
    )
    .groupBy(transactions.categoryId)
    .all()
  return new Map(rows.map((r) => [r.categoryId!, r]))
}

export function getBudgetMonth(month: string): BudgetMonth {
  checkMonth(month)
  const budgeted = budgetedSums(month)
  const activity = activitySums(month)
  const zero = { total: 0, month: 0 }

  let incomeToDate = 0
  let income = 0
  let budgetedToDate = 0
  const groups: BudgetGroup[] = []
  for (const group of listCategoryGroups()) {
    if (group.isIncome) {
      for (const c of group.categories) {
        const a = activity.get(c.id) ?? zero
        incomeToDate += a.total
        income += a.month
      }
      continue
    }
    const categories = group.categories.map((c) => {
      const b = budgeted.get(c.id) ?? zero
      const a = activity.get(c.id) ?? zero
      budgetedToDate += b.total
      return {
        id: c.id,
        name: c.name,
        hidden: c.hidden,
        budgeted: b.month,
        activity: a.month,
        available: b.total + a.total,
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
  return {
    month,
    income,
    budgeted: sum(groups.map((g) => g.budgeted)),
    activity: sum(groups.map((g) => g.activity)),
    available: sum(groups.map((g) => g.available)),
    toBudget: incomeToDate - budgetedToDate,
    groups,
  }
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
  const changes = amounts.map(({ categoryId, amount }) => {
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

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
