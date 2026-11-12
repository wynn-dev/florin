// Report summaries. Spending and income look at on-budget accounts only,
// leave out opening balances, and leave out transfers between two on-budget
// accounts (moving money is not spending it). Cash flow looks at the cash
// accounts among them (see cashFlowReport).
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import type { SQLiteSelect } from "drizzle-orm/sqlite-core"
import { STARTING_BALANCES, db, schema } from "../db"
import { listCategoryGroups } from "./categories"
import { convert } from "./fx"
import { getSettings } from "./settings"
import {
  InvalidInput,
  addMonths,
  checkDate,
  checkMonth,
  monthEnd,
  monthsBetween,
  today,
} from "./validate"
import type { SQL } from "drizzle-orm"
import type {
  AccountGroup,
  CashFlowReport,
  Conversion,
  IncomeExpenseReport,
  MonthSpending,
  NetWorthAccount,
  NetWorthReport,
  ReportQuery,
  SpendingByDay,
  SpendingCategory,
  SpendingGroup,
  SpendingReport,
} from "@/shared/reports"
import type {
  AccountType,
  CashFlowPoint,
  CategorySpending,
  DateRange,
  IncomeExpensePoint,
  NetWorthPoint,
} from "@/shared/types"

const {
  transactions,
  accounts,
  categories,
  categoryGroups,
  accountValues,
  fxRates,
} = schema
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
    sql`coalesce(${categories.key}, '') <> ${STARTING_BALANCES}`,
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

/** Per month: money in, money out (positive) and the difference, across the cash accounts (see cashFlowReport). */
export function cashFlow(input?: Partial<DateRange>): CashFlowPoint[] {
  return cashFlowReport(input).months.map(
    ({ month: m, inflow, outflow, net }) => ({ month: m, inflow, outflow, net })
  )
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

// ------------------------------------------------------------ the dashboard's reports
//
// The functions below answer the dashboard's Reports pages and Overview: each
// takes a range and optionally some accounts, and returns what its chart and
// table need in one answer.

/**
 * Reads a report's query parameters: from, to, all=true, accounts=1,2,3 and,
 * for net worth, step=day|week|month.
 */
export function reportQuery(
  params: Record<string, string | undefined>
): ReportQuery & { step?: NetWorthReport["step"] } {
  const step = params.step
  if (
    step !== undefined &&
    step !== "day" &&
    step !== "week" &&
    step !== "month"
  )
    throw new InvalidInput("step must be day, week or month")
  return {
    from: params.from || undefined,
    to: params.to || undefined,
    all: params.all === "true",
    accountIds: params.accounts
      ? params.accounts.split(",").map((id) => {
          const n = Number(id)
          if (!Number.isSafeInteger(n) || n <= 0)
            throw new InvalidInput(
              "accounts must be account ids, comma-separated"
            )
          return n
        })
      : undefined,
    step,
  }
}

const CASH_TYPES = ["checking", "savings", "cash"] as const

function accountGroup(type: AccountType): AccountGroup {
  if (type === "credit") return "credit"
  if (type === "investment") return "investments"
  return "cash"
}

/** "2026-11-30" plus n days. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000
  )
}

/** Moves a date by whole months, keeping the day where the month has it: 2026-03-31 − 1 → 2026-02-28. */
function shiftMonths(date: string, n: number): string {
  const shifted = addMonths(date.slice(0, 7), n)
  const end = monthEnd(shifted)
  const day = `${shifted}-${date.slice(8, 10)}`
  return day < end ? day : end
}

function checkAccountIds(ids: unknown): number[] {
  if (ids === undefined) return []
  if (
    !Array.isArray(ids) ||
    !ids.every((id) => Number.isSafeInteger(id) && id > 0)
  )
    throw new InvalidInput("accountIds must be a list of account ids")
  return ids as number[]
}

/** The earliest transaction or account value, in the given accounts (all when none). */
function firstDate(
  accountIds: number[],
  options: { onBudget?: boolean; values?: boolean } = {}
): string | null {
  const conditions = [
    accountIds.length ? inArray(transactions.accountId, accountIds) : undefined,
    options.onBudget ? eq(accounts.onBudget, true) : undefined,
  ]
  const fromTransactions = db()
    .select({ date: sql<string | null>`min(${transactions.date})` })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(...conditions))
    .get()?.date
  if (!options.values) return fromTransactions ?? null
  const fromValues = db()
    .select({ date: sql<string | null>`min(${accountValues.date})` })
    .from(accountValues)
    .where(
      accountIds.length
        ? inArray(accountValues.accountId, accountIds)
        : undefined
    )
    .get()?.date
  if (!fromTransactions || !fromValues)
    return fromTransactions ?? fromValues ?? null
  return fromTransactions < fromValues ? fromTransactions : fromValues
}

function resolveQuery(
  query: ReportQuery,
  dataFrom: string | null
): { range: DateRange; accountIds: number[] } {
  const accountIds = checkAccountIds(query.accountIds)
  const range = resolveRange({ to: query.to, from: query.from })
  if (query.all) range.from = dataFrom ?? range.from
  if (range.from > range.to)
    throw new InvalidInput("from must be on or before to")
  return { range, accountIds }
}

/**
 * Net worth over the range in the budget's currency, with each account's
 * start, end and change for the table. Accounts in another currency convert
 * at each point's date (the latest ECB rate on or before it).
 */
export function netWorthReport(
  query: ReportQuery & { step?: NetWorthReport["step"] } = {}
): NetWorthReport {
  const ids = checkAccountIds(query.accountIds)
  const dataFrom = firstDate(ids, { values: true })
  const { range } = resolveQuery(query, dataFrom)
  const budgetCurrency = getSettings().currency
  const step =
    query.step ?? (daysBetween(range.from, range.to) <= 92 ? "day" : "month")

  const dates: string[] = []
  if (step === "month") {
    for (const m of monthsBetween(range.from.slice(0, 7), range.to.slice(0, 7)))
      dates.push(monthEnd(m) < range.to ? monthEnd(m) : range.to)
  } else {
    const every = step === "week" ? 7 : 1
    for (let d = range.to; d >= range.from; d = addDays(d, -every))
      dates.unshift(d)
  }
  const before = addDays(range.from, -1)

  const accountList = db()
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currency: accounts.currency,
      closed: accounts.closed,
      sortOrder: accounts.sortOrder,
    })
    .from(accounts)
    .where(ids.length ? inArray(accounts.id, ids) : undefined)
    .orderBy(accounts.sortOrder, accounts.id)
    .all()
  const sums = db()
    .select({
      accountId: transactions.accountId,
      date: transactions.date,
      total: sql<number>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(
        sql`${transactions.date} <= ${range.to}`,
        ids.length ? inArray(transactions.accountId, ids) : undefined
      )
    )
    .groupBy(transactions.accountId, transactions.date)
    .orderBy(transactions.date)
    .all()
  const values = db()
    .select()
    .from(accountValues)
    .where(
      and(
        sql`${accountValues.date} <= ${range.to}`,
        ids.length ? inArray(accountValues.accountId, ids) : undefined
      )
    )
    .orderBy(accountValues.date)
    .all()
  const valued = new Set(values.map((v) => v.accountId))

  /** An account's balance at the end of each of `at` (ascending), in its own currency. */
  const balances = (id: number, at: string[]): number[] => {
    const out: number[] = []
    let balance = 0
    let i = 0
    if (valued.has(id)) {
      const own = values.filter((v) => v.accountId === id)
      for (const date of at) {
        while (i < own.length && own[i].date <= date) balance = own[i++].value
        out.push(balance)
      }
    } else {
      const own = sums.filter((s) => s.accountId === id)
      for (const date of at) {
        while (i < own.length && own[i].date <= date) balance += own[i++].total
        out.push(balance)
      }
    }
    return out
  }

  let missingRates = false
  const leftOut: string[] = []
  const points = dates.map((date) => ({
    date,
    assets: 0,
    liabilities: 0,
    netWorth: 0,
  }))
  const rows: NetWorthAccount[] = []
  for (const account of accountList) {
    const [start, ...series] = balances(account.id, [before, ...dates])
    const foreign = account.currency !== budgetCurrency
    series.forEach((own, i) => {
      if (own === 0) return
      const value = convert(own, account.currency, budgetCurrency, dates[i])
      if (value === null) {
        missingRates = true
        if (i === dates.length - 1) leftOut.push(account.name)
        return
      }
      if (value >= 0) points[i].assets += value
      else points[i].liabilities -= value
    })
    const end = series.length ? series[series.length - 1] : start
    if (account.closed && start === 0 && end === 0) continue
    const conversion = (amount: number, date: string): Conversion | null => {
      if (!foreign || amount === 0) return null
      const rate = crossRate(account.currency, budgetCurrency, date)
      return rate && { amount, ...rate }
    }
    const toBudget = (own: number, date: string) =>
      own === 0 ? 0 : convert(own, account.currency, budgetCurrency, date)
    const startValue = toBudget(start, before)
    const endValue = toBudget(end, range.to)
    rows.push({
      id: account.id,
      name: account.name,
      currency: account.currency,
      group: accountGroup(account.type),
      closed: account.closed,
      start: startValue,
      end: endValue,
      change:
        startValue === null || endValue === null ? null : endValue - startValue,
      startConversion: conversion(start, before),
      endConversion: conversion(end, range.to),
    })
  }
  for (const p of points) p.netWorth = p.assets - p.liabilities
  return {
    ...range,
    dataFrom,
    step,
    points,
    accounts: rows,
    missingRates,
    leftOut,
  }
}

/** Budget-currency units per unit of `from` on `date`, and the date of the rate used. */
function crossRate(
  from: string,
  to: string,
  date: string
): { rate: number; rateDate: string } | null {
  const lookup = (currency: string) =>
    currency === "EUR"
      ? { rate: 1, date: null }
      : (db()
          .select({ rate: fxRates.rate, date: fxRates.date })
          .from(fxRates)
          .where(and(eq(fxRates.currency, currency), lte(fxRates.date, date)))
          .orderBy(desc(fxRates.date))
          .limit(1)
          .get() ?? null)
  const a = lookup(from)
  const b = lookup(to)
  if (!a || !b) return null
  const dates = [a.date, b.date].filter((d): d is string => d !== null)
  return {
    rate: b.rate / a.rate,
    rateDate: dates.sort().at(-1) ?? date,
  }
}

/** The flow conditions plus an optional account filter. */
function flowsIn<T extends SQLiteSelect>(
  query: T,
  range: DateRange,
  accountIds: number[]
) {
  return query
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .leftJoin(leg, eq(transactions.transferId, leg.id))
    .leftJoin(legAccount, eq(leg.accountId, legAccount.id))
    .where(
      and(
        flowConditions(range),
        accountIds.length
          ? inArray(transactions.accountId, accountIds)
          : undefined
      )
    )
}

/**
 * Spending per category group and category over the range, each against the
 * same stretch of time one range-length earlier (the range moved back by as
 * many months as it covers). On-budget accounts only; transfers between them
 * aren't spending.
 */
export function spendingReport(query: ReportQuery = {}): SpendingReport {
  const ids = checkAccountIds(query.accountIds)
  const dataFrom = firstDate(ids, { onBudget: true })
  const { range } = resolveQuery(query, dataFrom)
  const months = monthsBetween(
    range.from.slice(0, 7),
    range.to.slice(0, 7)
  ).length
  const previousFrom = shiftMonths(range.from, -months)
  const previousTo = shiftMonths(range.to, -months)
  const inRange = sql`${transactions.date} >= ${range.from}`
  const inPrevious = sql`${transactions.date} <= ${previousTo}`
  const rows = flowsIn(
    db()
      .select({
        categoryId: transactions.categoryId,
        amount: sql<number>`-coalesce(sum(case when ${inRange} then ${transactions.amount} end), 0)`,
        previous: sql<number>`-coalesce(sum(case when ${inPrevious} then ${transactions.amount} end), 0)`,
      })
      .from(transactions)
      .$dynamic(),
    { from: previousFrom, to: range.to },
    ids
  )
    .groupBy(transactions.categoryId)
    .all()
  const byCategory = new Map(rows.map((r) => [r.categoryId, r]))

  const groups: SpendingGroup[] = []
  const uncategorized = byCategory.get(null)
  for (const group of listCategoryGroups()) {
    if (group.isIncome) continue
    const list: SpendingCategory[] = group.categories.flatMap((c) => {
      const r = byCategory.get(c.id)
      return r && (r.amount || r.previous)
        ? [{ categoryId: c.id, name: c.name, ...pick(r) }]
        : []
    })
    if (list.length) groups.push(spendingGroup(group.id, group.name, list))
  }
  if (uncategorized && (uncategorized.amount || uncategorized.previous)) {
    groups.push(
      spendingGroup(null, "Uncategorised", [
        { categoryId: null, name: "Uncategorised", ...pick(uncategorized) },
      ])
    )
  }
  groups.sort((a, b) => b.amount - a.amount || b.previous - a.previous)
  return {
    ...range,
    dataFrom,
    months,
    previousFrom,
    previousTo,
    total: groups.reduce((s, g) => s + g.amount, 0),
    previousTotal: groups.reduce((s, g) => s + g.previous, 0),
    groups,
  }
}

function pick(row: { amount: number; previous: number }) {
  return { amount: row.amount, previous: row.previous }
}

function spendingGroup(
  groupId: number | null,
  name: string,
  list: SpendingCategory[]
): SpendingGroup {
  return {
    groupId,
    name,
    amount: list.reduce((s, c) => s + c.amount, 0),
    previous: list.reduce((s, c) => s + c.previous, 0),
    categories: list.sort(
      (a, b) => b.amount - a.amount || b.previous - a.previous
    ),
  }
}

/** Income and expenses per month, the difference and the savings rate. On-budget accounts only. */
export function incomeExpenseReport(
  query: ReportQuery = {}
): IncomeExpenseReport {
  const ids = checkAccountIds(query.accountIds)
  const dataFrom = firstDate(ids, { onBudget: true })
  const { range } = resolveQuery(query, dataFrom)
  const rows = flowsIn(
    db()
      .select({
        month,
        income: sql<number>`coalesce(sum(case when ${categoryGroups.isIncome} = 1 then ${transactions.amount} end), 0)`,
        expenses: sql<number>`-coalesce(sum(case when coalesce(${categoryGroups.isIncome}, 0) = 0 then ${transactions.amount} end), 0)`,
      })
      .from(transactions)
      .$dynamic(),
    range,
    ids
  )
    .groupBy(month)
    .all()
  return {
    ...range,
    dataFrom,
    months: fillMonths(range, rows, (m) => ({
      month: m,
      income: 0,
      expenses: 0,
    })).map((r) => ({
      ...r,
      net: r.income - r.expenses,
      savingsRate: r.income > 0 ? (r.income - r.expenses) / r.income : null,
    })),
  }
}

/**
 * Money in and out of the cash accounts (on-budget checking, savings and
 * cash) per month, with their balance at the start and end of each month.
 * Moving money between two cash accounts is no flow; paying a card or
 * investing is money out, and opening balances aren't flows.
 */
export function cashFlowReport(query: ReportQuery = {}): CashFlowReport {
  const ids = checkAccountIds(query.accountIds)
  const cash = db()
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.onBudget, true),
        inArray(accounts.type, [...CASH_TYPES]),
        ids.length ? inArray(accounts.id, ids) : undefined
      )
    )
    .all()
    .map((a) => a.id)
  const dataFrom = cash.length ? firstDate(cash) : null
  const { range } = resolveQuery(query, dataFrom)
  const empty = (m: string) => ({ month: m, inflow: 0, outflow: 0 })
  if (!cash.length) {
    return {
      ...range,
      dataFrom,
      months: fillMonths(range, [], empty).map((r) => ({
        ...r,
        starting: 0,
        net: 0,
        ending: 0,
      })),
    }
  }
  const openingBalance = sql`coalesce(${categories.key}, '') = ${STARTING_BALANCES}`
  const internal = sql`coalesce(${leg.accountId} in (${sql.join(
    cash.map((id) => sql`${id}`),
    sql`, `
  )}), 0)`
  const rows = db()
    .select({
      month,
      inflow: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} end), 0)`,
      outflow: sql<number>`-coalesce(sum(case when ${transactions.amount} < 0 then ${transactions.amount} end), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .leftJoin(leg, eq(transactions.transferId, leg.id))
    .where(
      and(
        inArray(transactions.accountId, cash),
        sql`${transactions.date} between ${range.from} and ${range.to}`,
        sql`not ${openingBalance}`,
        sql`not ${internal}`
      )
    )
    .groupBy(month)
    .all()
  const balanceBefore = (date: string) =>
    db()
      .select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .where(
        and(
          inArray(transactions.accountId, cash),
          sql`${transactions.date} < ${date}`
        )
      )
      .get()!.total
  return {
    ...range,
    dataFrom,
    months: fillMonths(range, rows, empty).map((r) => {
      const start =
        r.month === range.from.slice(0, 7) ? range.from : r.month + "-01"
      const end = monthEnd(r.month) < range.to ? monthEnd(r.month) : range.to
      return {
        month: r.month,
        starting: balanceBefore(start),
        inflow: r.inflow,
        outflow: r.outflow,
        net: r.inflow - r.outflow,
        ending: balanceBefore(addDays(end, 1)),
      }
    }),
  }
}

/**
 * Cumulative spending (expenses as in Income & expenses) by day of month for
 * `month` (up to today when it is the current month) and the month before.
 */
export function spendingByDay(monthInput?: string): SpendingByDay {
  const now = today()
  const current = monthInput ? checkMonth(monthInput) : now.slice(0, 7)
  const previous = addMonths(current, -1)
  const day = sql<string>`${transactions.date}`
  const rows = flows(
    db()
      .select({
        date: day,
        expenses: sql<number>`-coalesce(sum(case when coalesce(${categoryGroups.isIncome}, 0) = 0 then ${transactions.amount} end), 0)`,
      })
      .from(transactions)
      .$dynamic(),
    { from: `${previous}-01`, to: monthEnd(current) }
  )
    .groupBy(transactions.date)
    .all()
  const byDate = new Map(rows.map((r) => [r.date, r.expenses]))
  const cumulative = (m: string): MonthSpending => {
    const last = monthEnd(m) < now ? monthEnd(m) : now
    const days: number[] = []
    let total = 0
    for (let d = `${m}-01`; d <= last; d = addDays(d, 1)) {
      total += byDate.get(d) ?? 0
      days.push(total)
    }
    return { month: m, days }
  }
  return { current: cumulative(current), previous: cumulative(previous) }
}
