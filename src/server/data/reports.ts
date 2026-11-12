// Report summaries. Spending, income and cash flow look at on-budget accounts
// only, leave out opening balances, and leave out transfers between two
// on-budget accounts (moving money is not spending it).
import { and, eq, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import type { SQLiteSelect } from "drizzle-orm/sqlite-core"
import { db, schema } from "../db"
import { convert } from "./fx"
import { getSettings } from "./settings"
import {
  addMonths,
  checkDate,
  monthEnd,
  monthsBetween,
  today,
} from "./validate"
import type { SQL } from "drizzle-orm"
import type {
  CashFlowPoint,
  CategorySpending,
  DateRange,
  IncomeExpensePoint,
  NetWorthPoint,
} from "@/shared/types"

const { transactions, accounts, categories, categoryGroups, accountValues } =
  schema
const leg = alias(transactions, "leg")
const legAccount = alias(accounts, "leg_account")

/** The last twelve months up to today, unless the range says otherwise. */
export function resolveRange(range: Partial<DateRange> = {}): DateRange {
  const to = range.to ? checkDate(range.to, "to") : today()
  const from = range.from
    ? checkDate(range.from, "from")
    : addMonths(to.slice(0, 7), -11) + "-01"
  return { from, to }
}

/** On-budget, in range, not an opening balance, not a transfer between on-budget accounts. */
function flowConditions(range: DateRange): SQL {
  return and(
    eq(accounts.onBudget, true),
    sql`${transactions.date} between ${range.from} and ${range.to}`,
    sql`not (coalesce(${categoryGroups.isIncome}, 0) = 1 and ${categories.name} = 'Starting balances')`,
    sql`coalesce(${legAccount.onBudget}, 0) = 0`
  )!
}

/** Adds the joins and conditions every flow report shares to a select on transactions. */
function flows<T extends SQLiteSelect>(query: T, range: DateRange) {
  return query
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .leftJoin(leg, eq(transactions.transferId, leg.id))
    .leftJoin(legAccount, eq(leg.accountId, legAccount.id))
    .where(flowConditions(range))
}

const month = sql<string>`substr(${transactions.date}, 1, 7)`

/**
 * Net worth at the end of each month in the budget's currency: accounts with
 * a positive balance are assets, negative ones debts. Accounts in another
 * currency are converted at that month end's rate (left out while no rate is known).
 */
export function netWorth(input?: Partial<DateRange>): NetWorthPoint[] {
  const range = resolveRange(input)
  const months = monthsBetween(range.from.slice(0, 7), range.to.slice(0, 7))
  const budgetCurrency = getSettings().currency
  const accountList = db()
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .all()

  const sums = db()
    .select({
      accountId: transactions.accountId,
      month,
      total: sql<number>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .where(sql`${transactions.date} <= ${range.to}`)
    .groupBy(transactions.accountId, month)
    .orderBy(month)
    .all()
  const values = db()
    .select()
    .from(accountValues)
    .where(sql`${accountValues.date} <= ${range.to}`)
    .orderBy(accountValues.date)
    .all()
  const valued = new Set(values.map((v) => v.accountId))

  return months.map((m) => {
    const end = monthEnd(m)
    let assets = 0
    let debts = 0
    for (const { id, currency } of accountList) {
      let balance = 0
      if (valued.has(id)) {
        for (const v of values)
          if (v.accountId === id && v.date <= end) balance = v.value
      } else {
        for (const s of sums)
          if (s.accountId === id && s.month <= m) balance += s.total
      }
      const value =
        convert(
          balance,
          currency,
          budgetCurrency,
          end < range.to ? end : range.to
        ) ?? 0
      if (value >= 0) assets += value
      else debts -= value
    }
    return { month: m, assets, debts, netWorth: assets - debts }
  })
}

/** Spending per expense category over the range (positive = money spent), largest first. */
export function spendingByCategory(
  input?: Partial<DateRange>
): CategorySpending[] {
  const range = resolveRange(input)
  const rows = flows(
    db()
      .select({
        categoryId: transactions.categoryId,
        categoryName: sql<string>`coalesce(${categories.name}, 'Uncategorized')`,
        groupName: sql<string>`coalesce(${categoryGroups.name}, '')`,
        amount: sql<number>`-sum(${transactions.amount})`,
      })
      .from(transactions)
      .$dynamic(),
    range
  )
    .groupBy(transactions.categoryId)
    .all()
  const income = incomeCategoryIds()
  return rows
    .filter((r) => r.amount !== 0 && !income.has(r.categoryId ?? -1))
    .sort((a, b) => b.amount - a.amount)
}

function incomeCategoryIds(): Set<number> {
  return new Set(
    db()
      .select({ id: categories.id })
      .from(categories)
      .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(eq(categoryGroups.isIncome, true))
      .all()
      .map((r) => r.id)
  )
}

/** Per month: income (income categories) and expenses (everything else, as a positive number). */
export function incomeVsExpenses(
  input?: Partial<DateRange>
): IncomeExpensePoint[] {
  const range = resolveRange(input)
  const rows = flows(
    db()
      .select({
        month,
        income: sql<number>`coalesce(sum(case when ${categoryGroups.isIncome} = 1 then ${transactions.amount} end), 0)`,
        expenses: sql<number>`-coalesce(sum(case when coalesce(${categoryGroups.isIncome}, 0) = 0 then ${transactions.amount} end), 0)`,
      })
      .from(transactions)
      .$dynamic(),
    range
  )
    .groupBy(month)
    .all()
  return fillMonths(range, rows, (m) => ({ month: m, income: 0, expenses: 0 }))
}

/** Per month: money in, money out (positive) and the difference, across on-budget accounts. */
export function cashFlow(input?: Partial<DateRange>): CashFlowPoint[] {
  const range = resolveRange(input)
  const rows = flows(
    db()
      .select({
        month,
        inflow: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} end), 0)`,
        outflow: sql<number>`-coalesce(sum(case when ${transactions.amount} < 0 then ${transactions.amount} end), 0)`,
      })
      .from(transactions)
      .$dynamic(),
    range
  )
    .groupBy(month)
    .all()
  return fillMonths(range, rows, (m) => ({
    month: m,
    inflow: 0,
    outflow: 0,
  })).map((r) => ({
    ...r,
    net: r.inflow - r.outflow,
  }))
}

function fillMonths<T extends { month: string }>(
  range: DateRange,
  rows: T[],
  empty: (m: string) => T
): T[] {
  const byMonth = new Map(rows.map((r) => [r.month, r]))
  return monthsBetween(range.from.slice(0, 7), range.to.slice(0, 7)).map(
    (m) => byMonth.get(m) ?? empty(m)
  )
}
