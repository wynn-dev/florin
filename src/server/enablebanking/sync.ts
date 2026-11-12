// Bank sync: fetches each linked bank account's transactions and balance and
// brings them into its florin account through importTransactions.
//
// De-duplication (the bank's own id first, a content hash only as a fallback):
// - a row with an entry_reference gets importedId "er:<ref>"; banks keep it
//   when a pending row is booked, so that row turns cleared in place;
// - a booked row without one gets "h:<hash of its content>#n";
// - a pending row without one gets "pend:<hash>#n"; once the bank stops
//   reporting a pending row it becomes its booked row or goes (applyRows);
// - a bank row that matches a row already in the account without a bank id
//   (typed in, or from a CSV) is attached to it rather than added again.
//
// Scheduled runs send no PSU headers (the bank's unattended limit, often 4 a
// day, applies); a sync the person starts sends them. On the bank's rate
// limit an account waits RATE_LIMIT_WAIT_MS and the others go on.
import { createHash } from "node:crypto"
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db, schema } from "../db"
import {
  getAccount,
  importTransactions,
  inBatch,
  logChange,
  releaseLeg,
} from "../data"
import { startingBalanceCategoryId } from "../data/categories"
import { minorDigits } from "../data/fx"
import { InvalidInput, NotFound, today } from "../data/validate"
import { EnableBankingError } from "./client"
import { api } from "./credentials"
import type { BankTransaction, Balance, Client, PsuHeaders } from "./client"
import type { Actor, ImportRow, TransactionStatus } from "@/shared/types"
import type { SyncHours, SyncResult } from "@/shared/enablebanking"

const {
  ebLinks,
  ebAccounts,
  ebSettings,
  transactions,
  changes,
  deletedImports,
} = schema

export const SYNC_JOB = "enable-banking"
/** How often the job looks for links that are due. */
export const SYNC_CHECK_MS = 15 * 60_000
export const RATE_LIMIT_WAIT_MS = 6 * 60 * 60_000
/** How far before the newest booked date an incremental sync starts. */
const OVERLAP_DAYS = 10
const MAX_PAGES = 100

export function syncHours(): SyncHours {
  const row = db()
    .select()
    .from(ebSettings)
    .where(eq(ebSettings.key, "syncHours"))
    .get()
  const hours = Number(row?.value)
  return hours === 12 || hours === 24 ? hours : 6
}

export function setSyncHours(hours: unknown): void {
  if (hours !== 6 && hours !== 12 && hours !== 24) {
    throw new InvalidInput("the sync interval must be 6, 12 or 24 hours")
  }
  db()
    .insert(ebSettings)
    .values({ key: "syncHours", value: String(hours) })
    .onConflictDoUpdate({
      target: ebSettings.key,
      set: { value: String(hours) },
    })
    .run()
}

// Mapping Enable Banking transactions to florin rows.

type Row = ImportRow & {
  importedId: string
  status: TransactionStatus
  /** Cancelled or rejected by the bank: removes a pending row with the same id. */
  cancelled: boolean
}

/** "12.30" or "-12.30" → 1230 minor units, unsigned (the sign comes from the indicator). */
export function parseAmount(value: string, digits: number): number {
  const text = String(value).trim().replace(/^[+-]/, "")
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match)
    throw new InvalidInput(
      `the bank sent an amount florin can't read: "${value}"`
    )
  const frac = (match[2] ?? "").padEnd(digits, "0")
  if (frac.length > digits && /[1-9]/.test(frac.slice(digits))) {
    throw new InvalidInput(
      `the bank sent more decimals than the currency has: "${value}"`
    )
  }
  return Number(match[1]) * 10 ** digits + Number(frac.slice(0, digits) || 0)
}

const name = (party: BankTransaction["creditor"]) => party?.name?.trim() || ""

/** Maps the bank's transactions to rows for one account (whose currency gives the decimals). */
export function mapTransactions(
  list: BankTransaction[],
  identificationHash: string,
  currency: string
): Row[] {
  const digits = minorDigits(currency)
  const seen = new Map<string, number>()
  return list.map((t) => {
    const unsigned = parseAmount(t.transaction_amount.amount, digits)
    const amount = t.credit_debit_indicator === "DBIT" ? -unsigned : unsigned
    const remittance = (t.remittance_information ?? [])
      .map((s) => s.trim())
      .filter(Boolean)
    const counterparty =
      t.credit_debit_indicator === "DBIT" ? name(t.creditor) : name(t.debtor)
    const payee =
      counterparty || remittance.find((s) => !/^[\d\s]+$/.test(s)) || ""
    const date = t.transaction_date || t.value_date || t.booking_date || today()
    const booked = t.status === "BOOK"
    const cancelled = t.status === "CNCL" || t.status === "RJCT"
    let importedId: string
    if (t.entry_reference) importedId = `er:${t.entry_reference}`
    else {
      const key = createHash("sha256")
        .update(
          [
            identificationHash,
            date,
            t.transaction_amount.amount,
            t.transaction_amount.currency,
            t.credit_debit_indicator,
            name(t.creditor),
            name(t.debtor),
            remittance.join("\n"),
          ].join("|")
        )
        .digest("hex")
        .slice(0, 32)
      const prefix = booked ? "h" : "pend"
      const n = (seen.get(`${prefix}:${key}`) ?? 0) + 1
      seen.set(`${prefix}:${key}`, n)
      importedId = `${prefix}:${key}#${n}`
    }
    const foreign =
      t.transaction_amount.currency !== currency
        ? ` (${t.transaction_amount.currency})`
        : ""
    return {
      date,
      amount,
      payee,
      notes: remittance.join(" ") + foreign,
      importedId,
      status: booked ? "cleared" : "pending",
      bookedDate:
        booked && t.booking_date && t.booking_date !== date
          ? t.booking_date
          : undefined,
      cancelled,
    }
  })
}

const BALANCE_ORDER = ["CLBD", "ITBD", "XPCD", "CLAV", "ITAV"]

/** The balance to compare florin's with: booked before available, never a card's available credit. */
export function pickBalance(
  balances: Balance[],
  kind: string
): Balance | undefined {
  const usable = balances.filter(
    (b) => !(kind === "CARD" && b.balance_type === "ITAV")
  )
  for (const type of BALANCE_ORDER) {
    const found = usable.find((b) => b.balance_type === type)
    if (found) return found
  }
  return usable[0]
}

// Fetching.

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const addDays = (date: string, n: number) =>
  isoDay(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000)

/** Calls the bank with PSU headers, once more without them if the bank refuses them. */
async function withPsu<T>(
  psu: PsuHeaders | undefined,
  fn: (psu?: PsuHeaders) => Promise<T>
): Promise<T> {
  try {
    return await fn(psu)
  } catch (error) {
    if (
      psu &&
      error instanceof EnableBankingError &&
      error.code === "PSU_HEADER_NOT_PROVIDED"
    )
      return fn(undefined)
    throw error
  }
}

async function fetchTransactions(
  client: Client,
  uid: string,
  from: string | null,
  psu: PsuHeaders | undefined
): Promise<{ list: BankTransaction[]; from: string | null }> {
  const fetchAll = async (query: {
    date_from?: string
    strategy?: "longest"
  }) => {
    const all: BankTransaction[] = []
    const keys = new Set<string>()
    let key: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const answer = await withPsu(psu, (p) =>
        client.transactions(uid, { ...query, continuation_key: key }, p)
      )
      all.push(...(answer.transactions ?? []))
      key = answer.continuation_key ?? undefined
      if (!key || keys.has(key)) break
      keys.add(key)
    }
    return all
  }
  // The first sync asks for everything the bank keeps; later ones from a little before the last booked day.
  const query = from ? { date_from: from } : { strategy: "longest" as const }
  try {
    return { list: await fetchAll(query), from }
  } catch (error) {
    if (
      error instanceof EnableBankingError &&
      error.code === "WRONG_TRANSACTIONS_PERIOD"
    ) {
      const later = addDays(today(), -89)
      return { list: await fetchAll({ date_from: later }), from: later }
    }
    throw error
  }
}

// Saving.

type Counts = {
  added: number
  updated: number
  removed: number
  matched: number
}

const DAY_MS = 86_400_000
const daysApart = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS
/** Ids florin gives bank rows; any other row (typed in, or from a CSV) has no bank id yet. */
const BANK_ID = /^(er|h|pend|eb):/

/** Whether the row was typed in or imported (its first log line isn't a bank sync's). */
function addedByPerson(
  tx: Pick<ReturnType<typeof db>, "select">,
  id: number
): boolean {
  const first = tx
    .select({ actor: changes.actor })
    .from(changes)
    .where(
      and(
        eq(changes.entity, "transaction"),
        eq(changes.entityId, id),
        eq(changes.action, "create")
      )
    )
    .orderBy(changes.id)
    .get()
  return !!first && !first.actor.startsWith("bank-sync")
}

/**
 * Brings one fetch into a florin account, the bank's answer being the truth:
 * - a pending row the bank books under the same id turns booked in place;
 * - a pending row the bank no longer reports as pending becomes the nearest
 *   booked row new in this fetch (same sign, date within 7 days, same payee
 *   text or an amount within 20%), keeping its category and notes and taking
 *   the booked amount; with no such row it is deleted, unless it was typed
 *   in (and only matched to the bank's pending row): that one is unmatched
 *   and stays, the person's;
 * - a bank row the person or an agent deleted stays deleted;
 * - a new bank row that matches a row without a bank id (same amount, date
 *   within 3 days, nearest first) is attached to it, keeping the person's
 *   payee, category and notes;
 * - the rest is imported.
 */
export function applyRows(
  actor: Actor,
  accountId: number,
  rows: Row[],
  from: string | null
): Counts {
  const account = getAccount(accountId)
  const result = db().transaction((tx) => {
    const deleted = new Set(
      tx
        .select({ id: deletedImports.importedId })
        .from(deletedImports)
        .where(eq(deletedImports.accountId, accountId))
        .all()
        .map((r) => r.id)
    )
    const live = rows.filter((r) => !r.cancelled && !deleted.has(r.importedId))
    const ids = live.map((r) => r.importedId)
    const known = new Map<string, typeof transactions.$inferSelect>()
    for (let i = 0; i < ids.length; i += 500) {
      tx.select()
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, accountId),
            inArray(transactions.importedId, ids.slice(i, i + 500))
          )
        )
        .all()
        .forEach((t) => known.set(t.importedId!, t))
    }
    let updated = 0
    let removed = 0
    let matched = 0
    let unmatched = 0
    const settled = new Set<number>()
    let fresh: Row[] = []
    for (const row of live) {
      const existing = known.get(row.importedId)
      if (!existing) {
        fresh.push(row)
        continue
      }
      // Only rows still pending follow the bank; booked rows are the person's to edit.
      if (existing.status !== "pending") continue
      settled.add(existing.id)
      if (
        row.status !== "pending" ||
        existing.amount !== row.amount ||
        existing.date !== row.date
      ) {
        tx.update(transactions)
          .set({
            status: row.status,
            amount: row.amount,
            date: row.date,
            bookedDate: row.bookedDate ?? null,
          })
          .where(eq(transactions.id, existing.id))
          .run()
        updated++
      }
    }

    // Pending rows the bank no longer reports as pending.
    const pending = tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountId),
          eq(transactions.status, "pending"),
          sql`(${transactions.importedId} like 'er:%' or ${transactions.importedId} like 'pend:%')`
        )
      )
      .all()
    for (const p of pending) {
      if (settled.has(p.id) || (from && p.date < from)) continue
      const payee = p.importedPayee?.toLowerCase() ?? ""
      const booked = fresh
        .filter(
          (r) =>
            r.status === "cleared" &&
            Math.sign(r.amount) === Math.sign(p.amount) &&
            daysApart(r.date, p.date) <= 7 &&
            ((payee !== "" && r.payee.toLowerCase() === payee) ||
              Math.abs(r.amount - p.amount) <= Math.abs(p.amount) * 0.2)
        )
        .sort(
          (a, b) => daysApart(a.date, p.date) - daysApart(b.date, p.date)
        )[0]
      if (booked) {
        fresh = fresh.filter((r) => r !== booked)
        tx.update(transactions)
          .set({
            importedId: booked.importedId,
            status: "cleared",
            amount: booked.amount,
            date: booked.date,
            bookedDate: booked.bookedDate ?? null,
            importedPayee: booked.payee || p.importedPayee,
          })
          .where(eq(transactions.id, p.id))
          .run()
        updated++
      } else if (addedByPerson(tx, p.id)) {
        tx.update(transactions)
          .set({
            importedId: null,
            importedPayee: null,
            bookedDate: null,
            status: "cleared",
          })
          .where(eq(transactions.id, p.id))
          .run()
        unmatched++
      } else {
        tx.delete(transactions).where(eq(transactions.id, p.id)).run()
        if (p.transferId) releaseLeg(tx, p.transferId)
        removed++
      }
    }

    // Rows already in the account without a bank id (typed in, or from a CSV).
    if (fresh.length) {
      const dates = fresh.map((r) => r.date).sort()
      const unlinked = tx
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, accountId),
            sql`${transactions.date} between ${addDays(dates[0], -3)} and ${addDays(dates.at(-1)!, 3)}`
          )
        )
        .all()
        .filter((t) => !t.importedId || !BANK_ID.test(t.importedId))
      const claimed = new Set<number>()
      fresh = fresh.filter((row) => {
        const m = unlinked
          .filter(
            (t) =>
              !claimed.has(t.id) &&
              t.amount === row.amount &&
              daysApart(t.date, row.date) <= 3
          )
          .sort(
            (a, b) => daysApart(a.date, row.date) - daysApart(b.date, row.date)
          )[0]
        if (!m) return true
        claimed.add(m.id)
        tx.update(transactions)
          .set({
            importedId: row.importedId,
            importedPayee: row.payee || null,
            bookedDate: row.bookedDate ?? null,
            status: row.status,
          })
          .where(eq(transactions.id, m.id))
          .run()
        matched++
        return false
      })
    }

    const plural = (n: number) => `${n} transaction${n === 1 ? "" : "s"}`
    if (updated) {
      logChange(tx, actor, {
        action: "update",
        entity: "transaction",
        summary: `Updated ${plural(updated)} the bank booked in ${account.name}`,
      })
    }
    if (removed) {
      logChange(tx, actor, {
        action: "delete",
        entity: "transaction",
        summary: `Removed ${removed} pending transaction${removed === 1 ? "" : "s"} the bank dropped from ${account.name}`,
      })
    }
    if (unmatched) {
      logChange(tx, actor, {
        action: "update",
        entity: "transaction",
        summary: `Unmatched ${plural(unmatched)} in ${account.name} from pending rows the bank dropped`,
      })
    }
    if (matched) {
      logChange(tx, actor, {
        action: "update",
        entity: "transaction",
        summary: `Matched ${plural(matched)} in ${account.name} to the bank's`,
      })
    }
    return { updated, removed, matched, toImport: fresh }
  })
  const { added } = result.toImport.length
    ? importTransactions(
        actor,
        accountId,
        result.toImport.map(({ cancelled: _, ...row }) => row)
      )
    : { added: 0 }
  return {
    added,
    updated: result.updated,
    removed: result.removed,
    matched: result.matched,
  }
}

/** Books a "Starting balance" before the first transaction so florin's balance matches the bank's. */
function setOpeningBalance(
  actor: Actor,
  accountId: number,
  bankBalance: number,
  includesPending: boolean
): void {
  const account = getAccount(accountId)
  const diff =
    bankBalance - (includesPending ? account.balance : account.clearedBalance)
  if (diff === 0) return
  const first = db()
    .select({ date: sql<string | null>`min(${transactions.date})` })
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
    .get()?.date
  importTransactions(actor, accountId, [
    {
      date: first ? addDays(first, -1) : today(),
      amount: diff,
      payee: "Starting balance",
      importedId: "eb:opening",
      categoryId: account.onBudget ? startingBalanceCategoryId() : null,
    },
  ])
}

type BankAccountRow = typeof ebAccounts.$inferSelect

async function syncAccount(
  client: Client,
  actor: Actor,
  acc: BankAccountRow & { accountId: number },
  psu: PsuHeaders | undefined
): Promise<Counts> {
  const account = getAccount(acc.accountId)
  // Later syncs start a little before the last booked day, and no later than
  // the oldest pending row, so the bank's answer covers every one of them.
  const oldestPending = db()
    .select({ date: sql<string | null>`min(${transactions.date})` })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, acc.accountId),
        eq(transactions.status, "pending"),
        sql`(${transactions.importedId} like 'er:%' or ${transactions.importedId} like 'pend:%')`
      )
    )
    .get()?.date
  const start = acc.lastSyncedAt
    ? [
        addDays(
          acc.lastBookedDate ?? addDays(today(), -90 + OVERLAP_DAYS),
          -OVERLAP_DAYS
        ),
        oldestPending,
      ]
        .filter((d): d is string => Boolean(d))
        .sort()[0]
    : null
  const { list, from } = await fetchTransactions(client, acc.uid, start, psu)
  const balances = await withPsu(psu, (p) => client.balances(acc.uid, p))
  const rows = mapTransactions(list, acc.identificationHash, account.currency)
  const counts = applyRows(actor, acc.accountId, rows, from)
  const balance = pickBalance(balances, acc.kind)
  const bankBalance =
    balance && balance.balance_amount.currency === account.currency
      ? (balance.balance_amount.amount.trim().startsWith("-") ? -1 : 1) *
        parseAmount(
          balance.balance_amount.amount,
          minorDigits(account.currency)
        )
      : null
  if (acc.setOpening && bankBalance !== null) {
    setOpeningBalance(
      actor,
      acc.accountId,
      bankBalance,
      balance?.balance_type === "ITAV"
    )
  }
  const newestBooked = list
    .filter((t) => t.status === "BOOK")
    .map((t) => t.booking_date || t.value_date || t.transaction_date)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1)
  const now = new Date().toISOString()
  db()
    .update(ebAccounts)
    .set({
      lastSyncedAt: now,
      lastBookedDate:
        [acc.lastBookedDate, newestBooked].filter(Boolean).sort().at(-1) ??
        null,
      nextAttemptAt: null,
      setOpening: false,
      ...(bankBalance !== null ? { bankBalance, bankBalanceAt: now } : {}),
    })
    .where(eq(ebAccounts.id, acc.id))
    .run()
  return counts
}

// Running.

const running = ((
  globalThis as { __florinBankSync?: Map<number, Promise<SyncResult>> }
).__florinBankSync ??= new Map())

export function isSyncing(linkId: number): boolean {
  return running.has(linkId)
}

/**
 * Syncs every linked account of a link. `psu` (the person's headers) marks a
 * sync the person started; without it the sync is a background one, which
 * skips accounts the bank has rate-limited. A sync already running is joined.
 */
export function syncLink(
  linkId: number,
  options: { psu?: PsuHeaders } = {}
): Promise<SyncResult> {
  let run = running.get(linkId)
  if (!run) {
    // One sync run of a link is one Activity entry, across its accounts.
    run = inBatch(() => runSync(linkId, options.psu)).finally(() =>
      running.delete(linkId)
    )
    running.set(linkId, run)
  }
  return run
}

async function runSync(
  linkId: number,
  psu: PsuHeaders | undefined
): Promise<SyncResult> {
  const link = db().select().from(ebLinks).where(eq(ebLinks.id, linkId)).get()
  if (!link) throw new NotFound("bank link not found")
  const result: SyncResult = {
    added: 0,
    updated: 0,
    removed: 0,
    matched: 0,
    error: null,
  }
  const now = new Date()
  const fail = (
    error: string,
    set: Partial<typeof ebLinks.$inferInsert> = {}
  ) => {
    db()
      .update(ebLinks)
      .set({ lastError: error, lastAttemptAt: now.toISOString(), ...set })
      .where(eq(ebLinks.id, linkId))
      .run()
    return { ...result, error }
  }
  if (link.status !== "active")
    return fail(
      link.lastError ??
        "Access to the bank has ended. Renew it to keep syncing."
    )
  if (Date.parse(link.validUntil) <= now.getTime()) {
    return fail("Access to the bank has expired. Renew it to keep syncing.", {
      status: "expired",
    })
  }
  let client: Client
  try {
    client = api()
  } catch (error) {
    return fail((error as Error).message)
  }
  const actor: Actor = `bank-sync:${link.bank.slice(0, 80)}`
  const accounts = db()
    .select()
    .from(ebAccounts)
    .where(and(eq(ebAccounts.linkId, linkId), isNotNull(ebAccounts.accountId)))
    .all() as (BankAccountRow & { accountId: number })[]
  const errors: string[] = []
  let synced = 0
  let status: "active" | "expired" | "revoked" = "active"
  for (const acc of accounts) {
    if (
      !psu &&
      acc.nextAttemptAt &&
      Date.parse(acc.nextAttemptAt) > now.getTime()
    ) {
      errors.push(
        "The bank's limit on background fetches was reached; florin tries again at the next sync."
      )
      continue
    }
    try {
      const counts = await syncAccount(client, actor, acc, psu)
      result.added += counts.added
      result.updated += counts.updated
      result.removed += counts.removed
      result.matched += counts.matched
      synced++
    } catch (error) {
      if (!(error instanceof EnableBankingError)) {
        console.error(`florin: bank sync of ${link.bank} failed:`, error)
        errors.push(
          error instanceof InvalidInput
            ? `Couldn't save what the bank sent: ${error.message}`
            : "Something went wrong saving what the bank sent."
        )
        continue
      }
      errors.push(error.message)
      if (error.kind === "consent") {
        status = error.code === "REVOKED_SESSION" ? "revoked" : "expired"
        break
      }
      if (error.kind === "credentials") break
      if (error.kind === "rate-limit") {
        db()
          .update(ebAccounts)
          .set({
            nextAttemptAt: new Date(
              now.getTime() + RATE_LIMIT_WAIT_MS
            ).toISOString(),
          })
          .where(eq(ebAccounts.id, acc.id))
          .run()
      }
    }
  }
  result.error = errors[0] ?? null
  db()
    .update(ebLinks)
    .set({
      status,
      lastAttemptAt: now.toISOString(),
      lastError: result.error,
      ...(synced ? { lastSyncAt: new Date().toISOString() } : {}),
    })
    .where(eq(ebLinks.id, linkId))
    .run()
  return result
}

/** Syncs every link (person-started with `psu`); the results summed. */
export async function syncAll(
  options: { psu?: PsuHeaders } = {}
): Promise<SyncResult> {
  const links = db()
    .select({ id: ebLinks.id })
    .from(ebLinks)
    .where(eq(ebLinks.status, "active"))
    .all()
  const total: SyncResult = {
    added: 0,
    updated: 0,
    removed: 0,
    matched: 0,
    error: null,
  }
  for (const { id } of links) {
    const r = await syncLink(id, options)
    total.added += r.added
    total.updated += r.updated
    total.removed += r.removed
    total.matched += r.matched
    total.error ??= r.error
  }
  return total
}

/** The job: syncs, in the background, each active link whose interval has passed since its last try. */
export async function syncDueLinks(): Promise<void> {
  const every = syncHours() * 60 * 60_000
  const now = Date.now()
  for (const link of db()
    .select()
    .from(ebLinks)
    .where(eq(ebLinks.status, "active"))
    .all()) {
    if (link.lastAttemptAt && Date.parse(link.lastAttemptAt) + every > now)
      continue
    await syncLink(link.id)
  }
}
