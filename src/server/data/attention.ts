// Needs attention: what Overview asks the person to look at. Two kinds:
// - the person's: things only they can do (renew a bank's access, fix a
//   failed sync or report). They show at once and sort first.
// - the agents': things an agent normally handles (uncategorised
//   transactions, an overspent category, money left unassigned). They show
//   only once they have been open for 24 hours, the agent being assumed on
//   it until then, or at once when no MCP client has been seen for 7 days.
// Each source is one function returning items; add a source by adding one.
import { and, eq, isNull, sql } from "drizzle-orm"
import { db, schema } from "../db"
import { listJobs } from "../jobs"
import { getBudgetMonth } from "./budget"
import { listCategoryGroups } from "./categories"
import { minorDigits } from "./fx"
import { getSettings } from "./settings"
import { listMcpTokens } from "./tokens"
import { monthEnd } from "./validate"
import type { Attention, AttentionItem } from "@/shared/attention"

const { transactions, accounts, budgets, changes } = schema

const HOUR = 3_600_000
const DAY = 24 * HOUR
export const GRACE_MS = DAY
export const AGENT_SEEN_MS = 7 * DAY
const MAX_ITEMS = 5

type Source = (now: Date) => AttentionItem[]

const personSources: Source[] = [failedJobs]
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

/**
 * A background job whose last run failed, for the jobs only the person can
 * fix. Keyed by job name; the reason is the job's error, first sentence.
 */
const PERSON_JOBS: Record<
  string,
  (reason: string) => Pick<AttentionItem, "text" | "action">
> = {
  "enable-banking": (reason) => ({
    text: `Bank sync failed: ${reason}`,
    action: { label: "Retry", post: "/api/jobs/enable-banking/run" },
  }),
  ibkr: (reason) => ({
    text: `IBKR report failed: ${reason}`,
    action: /token/i.test(reason)
      ? {
          label: "Update token",
          to: "/settings",
          search: { section: "connections" },
          hash: "ibkr",
        }
      : { label: "Retry", post: "/api/jobs/ibkr/run" },
  }),
}

function failedJobs(): AttentionItem[] {
  return listJobs().flatMap((job) => {
    const describe = PERSON_JOBS[job.name]
    if (!describe || !job.lastError) return []
    return [
      {
        id: `job:${job.name}`,
        who: "person" as const,
        since: job.lastStartedAt ?? new Date().toISOString(),
        ...describe(firstSentence(job.lastError)),
      },
    ]
  })
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
  const day = item.since.slice(0, 10)
  const days = Math.round(
    (Date.parse(now.toISOString().slice(0, 10)) - Date.parse(day)) / DAY
  )
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

function weekday(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`))
}

function shortDate(date: string, now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year:
      date.slice(0, 4) === String(now.getUTCFullYear()) ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`))
}

/** "€42", or "€42.10" when it has cents. */
function amount(cents: number, currency: string): string {
  const digits = minorDigits(currency)
  const whole = cents % 10 ** digits === 0
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : digits,
    maximumFractionDigits: whole ? 0 : digits,
  }).format(cents / 10 ** digits)
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7)
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
