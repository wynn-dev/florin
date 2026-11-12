// Two transactions florin already has, one leaving an account and one
// arriving in another (each bank sent its side), linked as one transfer, and
// the likely pairs among them.
import { and, eq, isNull, sql } from "drizzle-orm"
import { db, schema } from "../db"
import { CASH_MOVES } from "../ibkr/flex"
import { getAccount, listAccounts } from "./accounts"
import { logChange, money } from "./changes"
import { convert } from "./fx"
import {
  describeTransaction,
  eachItem,
  getTransaction,
  startingBalanceRow,
  transferCategories,
} from "./transactions"
import { checkDate, checkList, InvalidInput } from "./validate"
import { linkProblem } from "@/shared/transfers"
import type { SQL } from "drizzle-orm"
import type { Database } from "../db"
import type { Actor, Transaction } from "@/shared/types"

const { transactions, accounts, categories, payees } = schema

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0]

/** Days between two dates, either way round. */
function daysApart(a: string, b: string): number {
  return (
    Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
    86_400_000
  )
}

/**
 * Links pairs of existing transactions as transfers, all or none. Each pair:
 * two plain rows in different accounts, one money out and one money in; in
 * one currency the amounts must mirror exactly, across currencies each leg
 * keeps its own. Linked, they are a transfer like any florin makes: no payee,
 * and no category between two on-budget accounts (the on-budget leg keeps its
 * category when the other account is off budget). Each keeps its date,
 * status, notes, bank text and importedId, so the next sync recognises both.
 */
export function linkTransfers(
  actor: Actor,
  pairs: [number, number][]
): [Transaction, Transaction][] {
  checkList(pairs, "pairs")
  const ids = db().transaction((tx) => {
    const seen = new Set<number>()
    return pairs.map((pair, i) =>
      eachItem(pairs.length, i, () => {
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          !pair.every((id) => Number.isSafeInteger(id))
        )
          throw new InvalidInput("each pair must be two transaction ids")
        for (const id of pair[0] === pair[1] ? [] : pair) {
          if (seen.has(id))
            throw new InvalidInput(`transaction ${id} is in two pairs`)
          seen.add(id)
        }
        return linkPair(tx, actor, pair[0], pair[1])
      })
    )
  })
  return ids.map(([out, into]) => [getTransaction(out), getTransaction(into)])
}

/**
 * Links two rows as one transfer inside the caller's database transaction
 * (see linkTransfers), or throws why they can't be; answers [out, into].
 */
export function linkPair(
  tx: Tx,
  actor: Actor,
  first: number,
  second: number
): [number, number] {
  const [a, b] = [first, second].map((id) => getTransaction(id, tx))
  const problem = linkProblem(a, b, (id) => getAccount(id).currency, money)
  if (problem) throw new InvalidInput(problem)
  const [out, into] = a.amount < 0 ? [a, b] : [b, a]
  for (const [t, other] of [
    [out, into],
    [into, out],
  ])
    tx.update(transactions)
      .set({ transferId: other.id, payeeId: null })
      .where(eq(transactions.id, t.id))
      .run()
  transferCategories(tx, out.id)
  const linked = getTransaction(out.id, tx)
  logChange(tx, actor, {
    action: "update",
    entity: "transaction",
    entityId: out.id,
    relatedId: into.id,
    summary: `Linked ${describeTransaction(linked)} as a transfer${
      out.amount + into.amount === 0
        ? ""
        : `, ${money(into.amount, getAccount(into.accountId).currency)} arriving`
    }`,
    detail: `Linked as a transfer to ${into.accountName}`,
  })
  logChange(tx, actor, {
    action: "update",
    entity: "transaction",
    entityId: into.id,
    relatedId: out.id,
    summary: `Linked ${describeTransaction(getTransaction(into.id, tx))} as a transfer`,
    detail: `Linked as a transfer from ${out.accountName}`,
  })
  return [out.id, into.id]
}

export type TransferSuggestion = {
  /** The money leaving one account. */
  out: Transaction
  /** The money arriving in another. */
  into: Transaction
  /** Days between the two dates. */
  days: number
}

/** How far apart the two dates of a likely pair may be. */
export const MAX_DAYS = 4
/** How far apart, as a share, two amounts in different currencies may be at the day's rate. */
const RATE_SLACK = 0.03

/**
 * Rows that can be a leg of a transfer: plain (not a transfer), not empty,
 * not a starting balance, and in an investment account only a cash deposit
 * or withdrawal as the broker marks it (not a trade, interest, a dividend, a
 * fee or a currency conversion), or a row typed in by hand. Needs the row's
 * account, payee and category joined.
 */
function possibleLeg(): SQL {
  return and(
    isNull(transactions.transferId),
    sql`${transactions.amount} <> 0`,
    sql`not ${startingBalanceRow()}`,
    sql`(${accounts.type} <> 'investment' or ${transactions.importedPayee} is null or ${transactions.importedPayee} in (${CASH_MOVES.in}, ${CASH_MOVES.out}))`
  )!
}

/** Whether row `id` can be a leg of a transfer (see possibleLeg). */
export function isPossibleLeg(
  tx: Pick<Database, "select">,
  id: number
): boolean {
  return !!tx
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(payees, eq(transactions.payeeId, payees.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(eq(transactions.id, id), possibleLeg()))
    .get()
}

type LegRow = { accountId: number; date: string; amount: number }

/**
 * Whether `into` mirrors `out` (money out): in one currency the same amount,
 * across two within 3% at the day's exchange rate. Dates aside.
 */
function mirrors(out: LegRow, into: LegRow, currency: Map<number, string>) {
  const a = currency.get(out.accountId)!
  const b = currency.get(into.accountId)!
  if (a === b) return out.amount + into.amount === 0
  const expected = convert(-out.amount, a, b, out.date)
  return (
    expected !== null &&
    Math.abs(expected - into.amount) <= RATE_SLACK * into.amount
  )
}

/**
 * The one row in `accountId` that mirrors row `id` as the other leg of a
 * transfer (as suggestTransfers pairs them, within four days), or null: none
 * there, `id` can't be a leg itself, or two are equally close. Rows in
 * `taken` are passed over.
 */
export function findMirror(
  tx: Pick<Database, "select">,
  id: number,
  accountId: number,
  taken: Set<number> = new Set()
): number | null {
  const legs = () =>
    tx
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        date: transactions.date,
        amount: transactions.amount,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(payees, eq(transactions.payeeId, payees.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .$dynamic()
  const row = legs()
    .where(and(eq(transactions.id, id), possibleLeg()))
    .get()
  if (!row || row.accountId === accountId) return null
  const currency = new Map(listAccounts().map((a) => [a.id, a.currency]))
  const near = legs()
    .where(
      and(
        eq(transactions.accountId, accountId),
        possibleLeg(),
        row.amount < 0
          ? sql`${transactions.amount} > 0`
          : sql`${transactions.amount} < 0`,
        sql`${transactions.date} between ${addDays(row.date, -MAX_DAYS)} and ${addDays(row.date, MAX_DAYS)}`
      )
    )
    .all()
    .filter(
      (t) =>
        !taken.has(t.id) &&
        (row.amount < 0 ? mirrors(row, t, currency) : mirrors(t, row, currency))
    )
    .map((t) => ({ id: t.id, days: daysApart(t.date, row.date) }))
    .sort((x, y) => x.days - y.days)
  if (!near.length || near[1]?.days === near[0].days) return null
  return near[0].id
}

/** "2026-11-30" plus n days. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Likely transfers among rows that can be a leg (see possibleLeg): money out
 * of one account and in to another within four days, for the same amount in
 * one currency or within 3% at the day's exchange rate across two. Each row is in at most one suggestion, the closest dates winning; newest
 * first. `from`/`to` bound both rows' dates; `accountId` keeps pairs with a
 * row in that account.
 */
export function suggestTransfers(
  filter: { from?: string; to?: string; accountId?: number } = {}
): TransferSuggestion[] {
  const from = filter.from ? checkDate(filter.from, "from") : undefined
  const to = filter.to ? checkDate(filter.to, "to") : undefined
  if (filter.accountId !== undefined) getAccount(filter.accountId)
  const currency = new Map(listAccounts().map((a) => [a.id, a.currency]))
  const rows = db()
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      date: transactions.date,
      amount: transactions.amount,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(payees, eq(transactions.payeeId, payees.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        possibleLeg(),
        from ? sql`${transactions.date} >= ${from}` : undefined,
        to ? sql`${transactions.date} <= ${to}` : undefined
      )
    )
    .orderBy(transactions.date)
    .all()

  const candidates: {
    out: number
    into: number
    days: number
    date: string
  }[] = []
  const ins = rows.filter((r) => r.amount > 0)
  let first = 0
  for (const out of rows) {
    if (out.amount > 0) continue
    // Both lists are by date: skip what is too early for this row and later ones.
    while (
      first < ins.length &&
      ins[first].date < out.date &&
      daysApart(ins[first].date, out.date) > MAX_DAYS
    )
      first++
    for (let i = first; i < ins.length; i++) {
      const into = ins[i]
      if (into.date > out.date && daysApart(into.date, out.date) > MAX_DAYS)
        break
      if (into.accountId === out.accountId) continue
      if (
        filter.accountId !== undefined &&
        out.accountId !== filter.accountId &&
        into.accountId !== filter.accountId
      )
        continue
      if (!mirrors(out, into, currency)) continue
      candidates.push({
        out: out.id,
        into: into.id,
        days: daysApart(into.date, out.date),
        date: into.date > out.date ? into.date : out.date,
      })
    }
  }
  // Closest dates first; among equals the newest, then the lowest ids.
  candidates.sort(
    (x, y) =>
      x.days - y.days ||
      y.date.localeCompare(x.date) ||
      x.out - y.out ||
      x.into - y.into
  )
  const used = new Set<number>()
  const chosen = candidates.filter((c) => {
    if (used.has(c.out) || used.has(c.into)) return false
    used.add(c.out)
    used.add(c.into)
    return true
  })
  chosen.sort(
    (x, y) => y.date.localeCompare(x.date) || y.out - x.out || y.into - x.into
  )
  return chosen.map((c) => ({
    out: getTransaction(c.out),
    into: getTransaction(c.into),
    days: c.days,
  }))
}
