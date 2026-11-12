// Two transactions florin already has, one leaving an account and one
// arriving in another (each bank sent its side), linked as one transfer, and
// the likely pairs among them.
import { and, eq, isNull, sql } from "drizzle-orm"
import { STARTING_BALANCES, db, schema } from "../db"
import { getAccount, listAccounts } from "./accounts"
import { logChange, money } from "./changes"
import { convert } from "./fx"
import { describeTransaction, eachItem, getTransaction } from "./transactions"
import { checkDate, checkList, InvalidInput } from "./validate"
import { linkProblem } from "@/shared/transfers"
import type { Actor, Transaction } from "@/shared/types"

const { transactions, accounts, categories } = schema

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
        const [a, b] = pair.map((id) => getTransaction(id, tx))
        for (const t of a.id === b.id ? [] : [a, b]) {
          if (seen.has(t.id))
            throw new InvalidInput(`transaction ${t.id} is in two pairs`)
          seen.add(t.id)
        }
        const problem = linkProblem(
          a,
          b,
          (id) => getAccount(id).currency,
          money
        )
        if (problem) throw new InvalidInput(problem)
        const [out, into] = a.amount < 0 ? [a, b] : [b, a]
        const onBudget = (t: Transaction) => getAccount(t.accountId).onBudget
        const both = onBudget(out) && onBudget(into)
        for (const [t, other] of [
          [out, into],
          [into, out],
        ]) {
          tx.update(transactions)
            .set({
              transferId: other.id,
              payeeId: null,
              ...(both || !onBudget(t) ? { categoryId: null } : {}),
            })
            .where(eq(transactions.id, t.id))
            .run()
        }
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
        return [out.id, into.id] as const
      })
    )
  })
  return ids.map(([out, into]) => [getTransaction(out), getTransaction(into)])
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
const MAX_DAYS = 4
/** How far apart, as a share, two amounts in different currencies may be at the day's rate. */
const RATE_SLACK = 0.03

/**
 * Likely transfers among plain rows (not transfers, not opening balances):
 * money out of one account and in to another within four days, for the same
 * amount in one currency or within 3% at the day's exchange rate across two.
 * Each row is in at most one suggestion, the closest dates winning; newest
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
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        isNull(transactions.transferId),
        sql`${transactions.amount} <> 0`,
        sql`coalesce(${categories.key}, '') <> ${STARTING_BALANCES}`,
        from ? sql`${transactions.date} >= ${from}` : undefined,
        to ? sql`${transactions.date} <= ${to}` : undefined
      )
    )
    .orderBy(transactions.date)
    .all()

  const matches = (out: (typeof rows)[number], into: (typeof rows)[number]) => {
    const a = currency.get(out.accountId)!
    const b = currency.get(into.accountId)!
    if (a === b) return out.amount + into.amount === 0
    const expected = convert(-out.amount, a, b, out.date)
    return (
      expected !== null &&
      Math.abs(expected - into.amount) <= RATE_SLACK * into.amount
    )
  }
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
      if (!matches(out, into)) continue
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
