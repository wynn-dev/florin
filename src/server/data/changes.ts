// The change log: every write in the data layer records who made it and a
// short readable summary, inside the write's own database transaction. The
// lines one data-layer call writes share a batch (so do the lines of a sync
// or import run wrapped in inBatch); Activity shows one entry per batch.
import { AsyncLocalStorage } from "node:async_hooks"
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm"
import { db, schema } from "../db"
import { minorDigits } from "./fx"
import { InvalidInput, NotFound } from "./validate"
import type { SQL } from "drizzle-orm"
import type { Database } from "../db"
import type { Actor, Change, Page } from "@/shared/types"
import type {
  ActivityEntry,
  ActivityFilter,
  ActivityKind,
  ActivityPage,
  HistoryLine,
} from "@/shared/activity"

const { changes, transactions } = schema

export function checkActor(actor: unknown): Actor {
  if (
    actor === "person" ||
    actor === "bank-sync" ||
    actor === "ibkr" ||
    actor === "import" ||
    actor === "demo" ||
    (typeof actor === "string" &&
      /^(mcp|bank-sync):.{1,80}$|^import:.{1,200}$/.test(actor))
  ) {
    return actor as Actor
  }
  throw new InvalidInput(
    "actor must be person, ibkr, import, demo, mcp:<client>, bank-sync:<bank> or import:<file>"
  )
}

// The batch of the call writing now: per database transaction, or per run
// (inBatch), which wins so a run that spans several calls is one entry.
const transactionBatches = new WeakMap<object, number>()
const runs = new AsyncLocalStorage<{ batch?: number }>()

/**
 * Runs `fn` (a sync run, an import over several accounts) so that every
 * change it logs, across any number of data-layer calls, is one Activity
 * entry. Works across awaits; nested runs join the outer one.
 */
export function inBatch<T>(fn: () => T): T {
  return runs.getStore() ? fn() : runs.run({}, fn)
}

/** Logs one change and answers its batch (the Activity entry's id). */
export function logChange(
  tx: Pick<Database, "insert" | "update">,
  actor: Actor,
  change: Pick<Change, "action" | "entity" | "summary"> & {
    entityId?: number | null
    /** Another entity it touched, e.g. the category money moved out of. */
    relatedId?: number | null
    /** What changed on the entity alone, for its history: "Category set to Groceries". */
    detail?: string | null
  }
): number {
  const run = runs.getStore()
  const batch = run?.batch ?? transactionBatches.get(tx)
  const row = tx
    .insert(changes)
    .values({
      actor: checkActor(actor),
      ...change,
      entityId: change.entityId ?? null,
      relatedId: change.relatedId ?? null,
      detail: change.detail ?? null,
      batch: batch ?? null,
    })
    .returning({ id: changes.id })
    .get()
  if (batch === undefined) {
    tx.update(changes)
      .set({ batch: row.id })
      .where(eq(changes.id, row.id))
      .run()
    transactionBatches.set(tx, row.id)
    if (run) run.batch = row.id
  }
  return batch ?? row.id
}

/** Recent change lines, newest first; optionally only one actor's ("mcp:" matches every MCP client). */
export function listActivity(
  options: { actor?: string; limit?: number; offset?: number } = {}
): Page<Change> {
  const where = sourceCondition(options.actor)
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500)
  const items = db()
    .select()
    .from(changes)
    .where(where)
    .orderBy(desc(changes.id))
    .limit(limit)
    .offset(Math.max(options.offset ?? 0, 0))
    .all() as Change[]
  const total = db()
    .select({ n: sql<number>`count(*)` })
    .from(changes)
    .where(where)
    .get()!.n
  return { items, total }
}

/**
 * One actor, or every actor of a kind for a prefix ending in ":"; a prefix
 * also takes the bare form older lines carry ("import" for "import:").
 */
function sourceCondition(source: string | undefined): SQL | undefined {
  if (!source) return undefined
  if (!source.endsWith(":")) return eq(changes.actor, source)
  const like = sql`${changes.actor} like ${source.replace(/[\\%_]/g, (c) => "\\" + c) + "%"} escape '\\'`
  return or(like, eq(changes.actor, source.slice(0, -1)))
}

const KIND_ENTITIES: Record<ActivityKind, Change["entity"][]> = {
  transactions: ["transaction"],
  budget: ["budget"],
  accounts: ["account"],
  categories: ["category", "category group"],
  settings: ["settings", "payee", "fx rate", "mcp token"],
}

function kindOf(entity: string): ActivityKind {
  for (const [kind, entities] of Object.entries(KIND_ENTITIES))
    if ((entities as string[]).includes(entity)) return kind as ActivityKind
  return "settings"
}

function checkKind(kind: unknown): ActivityKind {
  if (typeof kind === "string" && kind in KIND_ENTITIES)
    return kind as ActivityKind
  throw new InvalidInput(
    `kind must be one of ${Object.keys(KIND_ENTITIES).join(", ")}`
  )
}

function checkTimestamp(value: string, field: string): string {
  if (Number.isNaN(Date.parse(value)))
    throw new InvalidInput(`${field} must be a date or an ISO timestamp`)
  return new Date(value).toISOString()
}

/**
 * Activity entries (one per change batch), newest first, with the filters
 * the Activity page offers. Page with `before`: the previous page's `next`.
 */
export function listActivityEntries(filter: ActivityFilter = {}): ActivityPage {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200)
  const where = and(
    sourceCondition(filter.source),
    filter.kind === undefined
      ? undefined
      : inArray(changes.entity, KIND_ENTITIES[checkKind(filter.kind)]),
    filter.from === undefined
      ? undefined
      : gte(changes.at, checkTimestamp(filter.from, "from")),
    filter.to === undefined
      ? undefined
      : lt(changes.at, checkTimestamp(filter.to, "to")),
    filter.before === undefined ? undefined : lt(changes.batch, filter.before),
    filter.entry === undefined ? undefined : eq(changes.batch, filter.entry)
  )
  const batches = db()
    .select({ batch: changes.batch })
    .from(changes)
    .where(where)
    .groupBy(changes.batch)
    .orderBy(desc(changes.batch))
    .limit(limit + 1)
    .all()
    .map((r) => r.batch!)
  const page = batches.slice(0, limit)
  return {
    items: entries(page),
    next: batches.length > limit ? page[page.length - 1] : null,
  }
}

/** One Activity entry by its id (the batch id). */
export function getActivityEntry(id: number): ActivityEntry {
  const [entry] = entries([id])
  if (!entry) throw new NotFound(`activity entry ${id}`)
  return entry
}

function entries(batches: number[]): ActivityEntry[] {
  if (!batches.length) return []
  const rows = db()
    .select()
    .from(changes)
    .where(inArray(changes.batch, batches))
    .orderBy(asc(changes.id))
    .all() as Change[]
  const existing = new Map(
    db()
      .select({
        batch: changes.batch,
        n: sql<number>`count(distinct ${transactions.id})`,
      })
      .from(changes)
      .innerJoin(transactions, eq(transactions.id, changes.entityId))
      .where(
        and(
          inArray(changes.batch, batches),
          eq(changes.entity, "transaction"),
          sql`${changes.action} <> 'delete'`
        )
      )
      .groupBy(changes.batch)
      .all()
      .map((r) => [r.batch!, r.n])
  )
  const byBatch = new Map<number, Change[]>()
  for (const row of rows) {
    const list = byBatch.get(row.batch) ?? []
    list.push(row)
    byBatch.set(row.batch, list)
  }
  return batches.flatMap((batch) => {
    const list = byBatch.get(batch)
    if (!list) return []
    const lines = list
      .filter((c) => !(c.entity === "transaction" && c.action !== "delete"))
      .map((c) => c.summary)
    return [
      {
        id: batch,
        at: list[0].at,
        actor: list[0].actor,
        kind: kindOf(list[0].entity),
        summary: entrySummary(list),
        count: list.length,
        transactions: existing.get(batch) ?? 0,
        lines: lines.slice(0, 10),
        lineCount: lines.length,
      },
    ]
  })
}

const VERBS = { create: "added", update: "changed", delete: "deleted" }

const PLURALS: Record<string, [string, string]> = {
  transaction: ["transaction", "transactions"],
  account: ["account", "accounts"],
  payee: ["payee", "payees"],
  category: ["category", "categories"],
  "category group": ["category group", "category groups"],
  budget: ["budget amount", "budget amounts"],
  settings: ["setting", "settings"],
  "fx rate": ["exchange rate", "exchange rates"],
  "mcp token": ["MCP token", "MCP tokens"],
}

function noun(entity: string, n: number): string {
  const [one, many] = PLURALS[entity] ?? [entity, `${entity}s`]
  return `${n} ${n === 1 ? one : many}`
}

/** "Added …" → "added …", leaving words like "MCP" alone. */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text
}

function joinPhrases(phrases: string[]): string {
  return phrases.length < 2
    ? (phrases[0] ?? "")
    : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`
}

/** True for a transaction update that only set or cleared the category. */
export function isCategorising(change: Pick<Change, "detail">): boolean {
  return /^Category (set to .+|cleared)$/.test(change.detail ?? "")
}

/**
 * What a batch did, to follow its source's name: one change reads as its own
 * summary; several as counts ("categorised 23 transactions", "added 8 and
 * changed 2 transactions", "budgeted 12 categories").
 */
export function entrySummary(list: Change[]): string {
  if (list.length === 1) return lowerFirst(list[0].summary)
  const byEntity = new Map<string, Change[]>()
  for (const c of list) {
    const group = byEntity.get(c.entity) ?? []
    group.push(c)
    byEntity.set(c.entity, group)
  }
  const phrases = [...byEntity].map(([entity, group]) => {
    if (entity === "transaction" && group.every(isCategorising))
      return `categorised ${noun(entity, group.length)}`
    if (
      entity === "budget" &&
      group.every((c) => c.summary.startsWith("Budgeted"))
    )
      return `budgeted ${noun("category", group.length)}`
    if (
      entity === "budget" &&
      group.every((c) => c.summary.startsWith("Moved"))
    )
      return `moved money ${group.length} times`
    const counts = (["create", "update", "delete"] as const)
      .map(
        (action) =>
          [action, group.filter((c) => c.action === action).length] as const
      )
      .filter(([, n]) => n > 0)
    if (counts.length === 1)
      return `${VERBS[counts[0][0]]} ${noun(entity, counts[0][1])}`
    // "added 8 and changed 2 transactions"
    const [, many] = PLURALS[entity] ?? [entity, `${entity}s`]
    return `${joinPhrases(counts.map(([action, n]) => `${VERBS[action]} ${n}`))} ${many}`
  })
  return joinPhrases(phrases)
}

/** Every source that has made a change, the most recent first. */
export function listActivitySources(): Actor[] {
  return db()
    .select({ actor: changes.actor })
    .from(changes)
    .groupBy(changes.actor)
    .orderBy(desc(sql`max(${changes.id})`))
    .all()
    .map((r) => r.actor as Actor)
}

/**
 * A transaction's history, oldest first: who added it and each change since,
 * on either leg of a transfer.
 */
export function transactionHistory(id: number): HistoryLine[] {
  const leg = db()
    .select({ transferId: transactions.transferId })
    .from(transactions)
    .where(eq(transactions.id, id))
    .get()
  const ids = leg?.transferId ? [id, leg.transferId] : [id]
  return db()
    .select()
    .from(changes)
    .where(
      and(eq(changes.entity, "transaction"), inArray(changes.entityId, ids))
    )
    .orderBy(asc(changes.id))
    .all()
    .map((c) => ({
      id: c.id,
      batch: c.batch ?? c.id,
      at: c.at,
      actor: c.actor as Actor,
      text: c.detail ?? c.summary,
    }))
}

/** Money for summaries: "−€42.50". */
export function money(amount: number, currency: string): string {
  const digits = minorDigits(currency)
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    signDisplay: "auto",
  })
    .format(amount / 10 ** digits)
    .replace("-", "−")
}

/** "name → Joint, closed → true" for change summaries. */
export function describe(set: Record<string, unknown>): string {
  return Object.entries(set)
    .map(([k, v]) => `${k} → ${v}`)
    .join(", ")
}
