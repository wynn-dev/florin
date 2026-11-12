// Needs attention: what Overview asks the person to look at. Two kinds:
// - the person's: things only they can do (renew a bank's access, fix a
//   failed sync or IBKR report). They show at once and sort first.
// - the agents': things an agent normally handles (uncategorised
//   transactions, an overspent category, money left unassigned). They show
//   only once they have been open for 24 hours, the agent being assumed on
//   it until then, or at once when no MCP client has been seen for 7 days.
// Each source is one function returning items; add a source by adding one.
import { and, eq, isNull, sql } from "drizzle-orm"
import { db, schema } from "../db"
import { listBankLinks } from "../enablebanking"
import { getIbkrStatus } from "../ibkr"
import { getBudgetMonth } from "./budget"
import { listCategoryGroups } from "./categories"
import { minorDigits } from "./fx"
import { getSettings } from "./settings"
import { listMcpTokens } from "./tokens"
import { dayIn, monthEnd, thisMonth, timeZone, today } from "./validate"
import type { Attention, AttentionItem } from "@/shared/attention"

const { transactions, accounts, budgets, changes, ibkr } = schema

const HOUR = 3_600_000
const DAY = 24 * HOUR
export const GRACE_MS = DAY
export const AGENT_SEEN_MS = 7 * DAY
const MAX_ITEMS = 5

type Source = (now: Date) => AttentionItem[]

const personSources: Source[] = [bankAccess, failedIbkrReport]
const agentSources: Source[] = [uncategorized, overspent, unassigned]

export function needsAttention(now: Date = new Date()): Attention {
  const seen = lastAgentSeen()
  const grace =
    seen && now.getTime() - Date.parse(seen) <= AGENT_SEEN_MS ? GRACE_MS : 0
  const byAge = (a: AttentionItem, b: AttentionItem) =>
    a.since.localeCompare(b.since)
  const person = personSources.flatMap((source) => source(now)).sort(byAge)
  const agent = agentSources
    .flatMap((source) => source(new Date(now.getTime() - grace)))
    .filter((item) => now.getTime() - Date.parse(item.since) >= grace)
    .map((item) => ({ ...item, text: withAge(item, now) }))
    .sort(byAge)
  return {
    items: [...person, ...agent].slice(0, MAX_ITEMS),
    graceHours: grace / HOUR,
  }
}

/** When an MCP client was last seen: the newest use of an access token, or of a change one made. */
function lastAgentSeen(): string | null {
  const wrote = db()
    .select({ at: sql<string | null>`max(${changes.at})` })
    .from(changes)
    .where(sql`${changes.actor} like 'mcp:%'`)
    .get()?.at
  const times = [
    wrote,
    ...listMcpTokens().map((token) => token.lastUsedAt),
  ].filter((at): at is string => !!at)
  return times.length
    ? new Date(Math.max(...times.map((at) => Date.parse(at)))).toISOString()
    : null
}

// ------------------------------------------------------------ the person's

/** A bank's access ending within this many days asks for a renewal. */
export const RENEW_DAYS = 7

/**
 * Each bank link's own state: access ended or revoked, or ending within
 * RENEW_DAYS (Renew, which comes back to Overview), else its last sync's
 * error (Retry on that link).
 */
function bankAccess(now: Date): AttentionItem[] {
  return listBankLinks().flatMap((link): AttentionItem[] => {
    const base = `/api/connections/enable-banking/links/${link.id}`
    const renew = {
      label: "Renew",
      post: `${base}/renew`,
      body: { returnTo: "/" },
    }
    const end = Date.parse(link.validUntil)
    if (link.state === "revoked" || link.state === "expired" || end <= +now)
      return [
        {
          id: `bank:${link.id}`,
          who: "person",
          since: link.validUntil,
          text: `${link.bank} access ${link.state === "revoked" ? "was revoked" : "ended"}`,
          action: renew,
        },
      ]
    if (end - now.getTime() < RENEW_DAYS * DAY)
      return [
        {
          id: `bank:${link.id}`,
          who: "person",
          since: new Date(end - RENEW_DAYS * DAY).toISOString(),
          text: `${link.bank} access ends ${endDay(link.validUntil, now)}`,
          action: renew,
        },
      ]
    if (link.lastError)
      return [
        {
          id: `bank:${link.id}`,
          who: "person",
          since: link.lastAttemptAt ?? now.toISOString(),
          text: `Bank sync failed: ${reason(link.lastError)}`,
          action: { label: "Retry", post: `${base}/sync` },
        },
      ]
    return []
  })
}

/** "today", "tomorrow" or "on 18 Nov". */
function endDay(iso: string, now: Date): string {
  const end = dayIn(new Date(iso), timeZone())
  const days = Math.round((Date.parse(end) - Date.parse(today(now))) / DAY)
  if (days <= 0) return "today"
  if (days === 1) return "tomorrow"
  return `on ${shortDate(end, now)}`
}

/**
 * The last IBKR pull's error, scheduled or by hand, from the connector's own
 * state. One that needs the person (an expired token, a query to change)
 * stops the daily pull, so its fix is in Settings; a passing one can be
 * retried.
 */
function failedIbkrReport(): AttentionItem[] {
  const state = db().select().from(ibkr).get()
  if (!state?.lastError || !getIbkrStatus().configured) return []
  const why = reason(state.lastError)
  const settings = {
    to: "/settings",
    search: { section: "connections" },
    hash: "ibkr",
  }
  return [
    {
      id: "ibkr",
      who: "person",
      since: state.lastPullAt ?? new Date().toISOString(),
      text: `IBKR report failed: ${why}`,
      action: !state.needsPerson
        ? { label: "Retry", post: "/api/connections/ibkr/pull" }
        : /token/i.test(why)
          ? { label: "Update token", ...settings }
          : { label: "Open settings", ...settings },
    },
  ]
}

/** An error's first sentence, to follow a colon: "your token has expired". */
function reason(error: string): string {
  const text = firstSentence(error)
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text
}

function firstSentence(text: string): string {
  const sentence = text.split(/(?<=[.!?])\s/)[0].replace(/\.$/, "")
  return sentence.length > 80 ? sentence.slice(0, 79) + "…" : sentence
}

// ------------------------------------------------------------ the agents'
//
// Each takes `cutoff` (now minus the grace period) and returns its item with
// `since` set; needsAttention drops items younger than the grace period and
// writes their age into the text, where "{age}" stands.

/** On-budget transactions with no category (transfers need none), open since they arrived. */
function uncategorized(cutoff: Date): AttentionItem[] {
  const row = db()
    .select({
      count: sql<number>`count(*)`,
      first: sql<string | null>`min(${transactions.createdAt})`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        eq(accounts.onBudget, true),
        isNull(transactions.categoryId),
        isNull(transactions.transferId),
        sql`${transactions.createdAt} <= ${sqlTime(cutoff)}`
      )
    )
    .get()
  if (!row?.count || !row.first) return []
  return [
    {
      id: "uncategorized",
      who: "agent",
      text: `${row.count} ${row.count === 1 ? "transaction" : "transactions"} uncategorised {for}`,
      since: isoTime(row.first),
      action: {
        label: "Review",
        to: "/transactions",
        search: { uncategorized: true },
      },
    },
  ]
}

/** This month's overspent categories, each since its available amount last went below zero. */
function overspent(): AttentionItem[] {
  const month = thisMonth()
  const currency = getSettings().currency
  return getBudgetMonth(month).groups.flatMap((group) =>
    group.categories.flatMap((category) => {
      if (category.available >= 0) return []
      const since = overspentSince(category.id, month)
      if (!since) return []
      return [
        {
          id: `overspent:${category.id}`,
          who: "agent" as const,
          text: `${category.name} {has been|is} ${amount(-category.available, currency)} over {since}`,
          since,
          action: { label: "Cover", to: `/budget/${month}` },
        },
      ]
    })
  )
}

/**
 * Replays a category's envelope (each month's assignment at the month's
 * start, then its transactions as they are dated and arrived) and returns
 * when it last went below zero.
 */
function overspentSince(categoryId: number, month: string): string | null {
  const assigned = db()
    .select({ month: budgets.month, amount: budgets.amount })
    .from(budgets)
    .where(
      and(eq(budgets.categoryId, categoryId), sql`${budgets.month} <= ${month}`)
    )
    .all()
    .map((b) => ({ date: `${b.month}-01`, at: "", amount: b.amount }))
  const spent = db()
    .select({
      date: transactions.date,
      at: transactions.createdAt,
      amount: transactions.amount,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        eq(accounts.onBudget, true),
        eq(transactions.categoryId, categoryId),
        sql`${transactions.date} <= ${monthEnd(month)}`
      )
    )
    .all()
  return lastCrossing([...assigned, ...spent], (balance) => balance < 0)
}

/** Money no category has been given, since the balance to assign last turned positive. */
function unassigned(): AttentionItem[] {
  const month = thisMonth()
  const toBudget = getBudgetMonth(month).toBudget
  if (toBudget <= 0) return []
  const income = new Set(
    listCategoryGroups()
      .filter((g) => g.isIncome)
      .flatMap((g) => g.categories.map((c) => c.id))
  )
  const assigned = db()
    .select({ month: budgets.month, amount: budgets.amount })
    .from(budgets)
    .where(sql`${budgets.month} <= ${month}`)
    .all()
    .map((b) => ({ date: `${b.month}-01`, at: "", amount: -b.amount }))
  const received = db()
    .select({
      date: transactions.date,
      at: transactions.createdAt,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        eq(accounts.onBudget, true),
        sql`${transactions.categoryId} is not null`,
        sql`${transactions.date} <= ${monthEnd(month)}`
      )
    )
    .all()
    .filter((t) => income.has(t.categoryId!))
  const since = lastCrossing([...assigned, ...received], (b) => b > 0)
  if (!since) return []
  return [
    {
      id: "unassigned",
      who: "agent",
      text: `${amount(toBudget, getSettings().currency)} unassigned {since}`,
      since,
      action: { label: "Assign", to: `/budget/${month}` },
    },
  ]
}

/**
 * Runs a balance through dated amounts (assignments, at "", go first on
 * their day) and returns when `bad(balance)` last started holding: the later
 * of that day's start and when the amount arrived in florin.
 */
function lastCrossing(
  events: { date: string; at: string; amount: number }[],
  bad: (balance: number) => boolean
): string | null {
  events.sort(
    (a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at)
  )
  let balance = 0
  let since: string | null = null
  for (const e of events) {
    const was = bad(balance)
    balance += e.amount
    if (!bad(balance)) since = null
    else if (!was) {
      const day = `${e.date}T00:00:00.000Z`
      const arrived = e.at ? isoTime(e.at) : day
      since = arrived > day ? arrived : day
    }
  }
  return since
}

// ------------------------------------------------------------ wording

/**
 * Fills in an item's age. In its text, "{for}" becomes "for over a day",
 * "for 3 days" or "since 2 Oct"; "{since}" becomes "since yesterday", "since
 * Tuesday" or "since 2 Oct"; "{a|b}" picks a once it has an age, else b. An
 * item under a day old (no grace period) gets no age.
 */
function withAge(item: AttentionItem, now: Date): string {
  const age = now.getTime() - Date.parse(item.since)
  const fresh = age < DAY
  const day = dayIn(new Date(item.since), timeZone())
  const days = Math.round((Date.parse(today(now)) - Date.parse(day)) / DAY)
  const sinceText =
    days <= 1
      ? "since yesterday"
      : days < 7
        ? `since ${weekday(day)}`
        : `since ${shortDate(day, now)}`
  const forText =
    age < 2 * DAY
      ? "for over a day"
      : age < 7 * DAY
        ? `for ${Math.floor(age / DAY)} days`
        : `since ${shortDate(day, now)}`
  return item.text
    .replace(/\{([^|}]*)\|([^}]*)\}/g, (_, aged: string, young: string) =>
      fresh ? young : aged
    )
    .replace(/ ?\{for\}/, fresh ? "" : ` ${forText}`)
    .replace(/ ?\{since\}/, fresh ? "" : ` ${sinceText}`)
}

/** The weekday's name, in English like the rest of the text. */
function weekday(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`))
}

/** The person's locale for numbers and dates, as the dashboard formats them. */
const locale = () => getSettings().locale || "en-GB"

/** "2 Oct" in the person's locale ("2. Okt." in de-DE), with the year when not this one. */
function shortDate(date: string, now: Date): string {
  return new Intl.DateTimeFormat(locale(), {
    day: "numeric",
    month: "short",
    year: date.slice(0, 4) === today(now).slice(0, 4) ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`))
}

/** "€42", or "€42.10" when it has cents, in the person's locale ("42 €"). */
function amount(cents: number, currency: string): string {
  const digits = minorDigits(currency)
  const whole = cents % 10 ** digits === 0
  return new Intl.NumberFormat(locale(), {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : digits,
    maximumFractionDigits: whole ? 0 : digits,
  })
    .format(cents / 10 ** digits)
    .replace(/-/g, "−")
}

/** created_at is SQLite's "YYYY-MM-DD HH:MM:SS" in UTC. */
function isoTime(sqliteTime: string): string {
  return sqliteTime.includes("T")
    ? sqliteTime
    : `${sqliteTime.replace(" ", "T")}.000Z`
}

function sqlTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ")
}
