// Pulling IBKR Flex reports into florin. Each IBKR account in a report is a
// tracking-only investment account in its base currency (provider "ibkr",
// externalId = IBKR's account id). A pull upserts the account's daily values,
// replaces its holdings, and adds trades and cash movements as transactions
// de-duplicated on IBKR's transactionID; all of it in one database
// transaction with one line in the change log. The account's worth is its
// latest value, never the sum of those transactions.
//
// Request limits: pulls are spaced at least a minute apart and run one at a
// time. An error only the person can fix (expired token, wrong query) stops
// the daily pull until the token or query id changes; "too many requests"
// waits a minute; "too many failed attempts" waits until tomorrow.
import { and, eq, inArray, sql } from "drizzle-orm"
import { db, schema } from "../db"
import { runJobSoon } from "../jobs"
import { deleteSecret, getSecret, secretInfo, setSecret } from "../secrets"
import {
  checkHoldings,
  getSettings,
  logChange,
  money,
  payeeIdForName,
} from "../data"
import { rateOn } from "../data/fx"
import { InvalidInput, today } from "../data/validate"
import { fetchFlexReport } from "./client"
import { IbkrError } from "./errors"
import { parseFlexReport } from "./flex"
import type { FlexClientOptions } from "./client"
import type { FlexAccountReport, OutsideRate } from "./flex"
import type {
  FlexSection,
  IbkrAccount,
  IbkrCredentials,
  IbkrStatus,
} from "@/shared/ibkr"
import type { Actor, Holding } from "@/shared/types"

export const IBKR_JOB = "ibkr"
export const IBKR_EVERY_MS = 24 * 60 * 60 * 1000
export const TOKEN_KEY = "ibkr.token"
/** The least time between two pulls. */
export const PULL_SPACING_MS = 60_000
/** Days of overlap with the previous report, so late postings are caught. */
const OVERLAP_DAYS = 3

const { accounts, accountValues, holdings, transactions, ibkr } = schema

/** A rate the report itself lacks, from florin's ECB rates (per EUR, crossed). */
const ecbRate: OutsideRate = (currency, base, date) => {
  const from = rateOn(currency, date)
  const to = rateOn(base, date)
  return from && to ? (to / from).toFixed(10) : null
}

/** A pull refused because IBKR's limits don't allow one yet; /api answers 429. */
export class TooSoon extends IbkrError {
  constructor(
    message: string,
    readonly allowedAt: string
  ) {
    super(message, "throttled")
  }
}

const state = ((
  globalThis as { __florinIbkr?: { running?: Promise<unknown> } }
).__florinIbkr ??= {})

/** Replaced in tests: how the client waits and fetches. */
export const clientOptions: FlexClientOptions = {}

function row() {
  return (
    db().select().from(ibkr).where(eq(ibkr.id, 1)).get() ??
    db().insert(ibkr).values({ id: 1 }).returning().get()
  )
}

function save(set: Partial<typeof ibkr.$inferInsert>): void {
  row()
  db().update(ibkr).set(set).where(eq(ibkr.id, 1)).run()
}

/** "U1234567" → "U•••4567". */
export function maskAccountId(id: string): string {
  return id.length <= 4 ? "•••" : `${id[0]}•••${id.slice(-4)}`
}

function nextAllowedAt(r: ReturnType<typeof row>): string | null {
  const times = [
    r.lastPullStartedAt ? Date.parse(r.lastPullStartedAt) + PULL_SPACING_MS : 0,
    r.blockedUntil ? Date.parse(r.blockedUntil) : 0,
  ]
  const at = Math.max(...times)
  return at > Date.now() ? new Date(at).toISOString() : null
}

export function ibkrAccounts(): IbkrAccount[] {
  const latest = sql<
    string | null
  >`(select max(${accountValues.date}) from ${accountValues} where ${accountValues.accountId} = ${accounts.id})`
  const value = sql<
    number | null
  >`(select ${accountValues.value} from ${accountValues} where ${accountValues.accountId} = ${accounts.id} order by ${accountValues.date} desc limit 1)`
  return db()
    .select({
      id: accounts.id,
      name: accounts.name,
      externalId: accounts.externalId,
      currency: accounts.currency,
      value,
      asOf: latest,
    })
    .from(accounts)
    .where(eq(accounts.provider, "ibkr"))
    .orderBy(accounts.id)
    .all()
    .map(({ externalId, ...a }) => ({
      ...a,
      maskedId: maskAccountId(externalId ?? ""),
    }))
}

export function getIbkrStatus(): IbkrStatus {
  const r = row()
  const token = secretInfo(TOKEN_KEY)
  return {
    configured: token.set && Boolean(r.queryId),
    token,
    queryId: r.queryId,
    accounts: ibkrAccounts(),
    lastReportAt: r.lastReportAt,
    lastPullAt: r.lastPullAt,
    lastError: r.lastError,
    running: state.running !== undefined,
    nextPullAllowedAt: nextAllowedAt(r),
    missingSections: JSON.parse(r.missingSections) as FlexSection[],
  }
}

function checkQueryId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : String(value ?? "")
  if (!/^\d{1,12}$/.test(id))
    throw new InvalidInput(
      "The query ID is the number IBKR shows beside the Flex query's name."
    )
  return id
}

function checkToken(value: unknown): string {
  const token = typeof value === "string" ? value.trim() : ""
  if (!/^\d{8,40}$/.test(token))
    throw new InvalidInput(
      "A Flex token is a long number. Copy it again from IBKR's Flex Web Service Configuration."
    )
  return token
}

function whenText(iso: string): string {
  const seconds = Math.ceil((Date.parse(iso) - Date.now()) / 1000)
  if (seconds <= 90) return `in ${seconds} s`
  return `after ${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`
}

/** Runs one pull at a time; a second caller waits for the first. */
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  while (state.running) await state.running.catch(() => {})
  const run = fn()
  state.running = run
  try {
    return await run
  } finally {
    state.running = undefined
  }
}

/**
 * Pulls the report now with the saved token and query id. Throws TooSoon when
 * IBKR's limits don't allow a pull yet, and IbkrError when the pull fails.
 */
export async function pullIbkr(): Promise<IbkrStatus> {
  await exclusive(async () => {
    const r = row()
    const token = getSecret(TOKEN_KEY)
    if (!token || !r.queryId)
      throw new InvalidInput("Add your IBKR Flex token and query ID first.")
    await pull(token, r.queryId, false)
  })
  return getIbkrStatus()
}

/**
 * Saves a new token and/or query id, but only after a real pull with them
 * succeeds; the pull's data is kept. Throws in plain words otherwise, and
 * the saved credentials stay as they were.
 */
export async function connectIbkr(
  actor: Actor,
  input: IbkrCredentials
): Promise<IbkrStatus> {
  if (!input || typeof input !== "object")
    throw new InvalidInput("the body must be a JSON object")
  const queryId = checkQueryId(input.queryId)
  const newToken =
    input.token === undefined ? undefined : checkToken(input.token)
  const token = newToken ?? getSecret(TOKEN_KEY)
  if (!token) throw new InvalidInput("Paste your IBKR Flex token.")
  await exclusive(async () => {
    await pull(token, queryId, true)
    if (newToken) setSecret(TOKEN_KEY, newToken)
    db().transaction((tx) => {
      tx.update(ibkr).set({ queryId }).where(eq(ibkr.id, 1)).run()
      logChange(tx, actor, {
        action: "update",
        entity: "settings",
        summary: newToken
          ? `Connected Interactive Brokers with a new Flex token (query ${queryId})`
          : `Set the IBKR Flex query to ${queryId}`,
      })
    })
  })
  return getIbkrStatus()
}

/** Forgets the token and query id. The accounts, their values and transactions stay. */
export function disconnectIbkr(actor: Actor): IbkrStatus {
  deleteSecret(TOKEN_KEY)
  db().transaction((tx) => {
    tx.update(ibkr)
      .set({
        queryId: null,
        lastError: null,
        needsPerson: false,
        missingSections: "[]",
      })
      .where(eq(ibkr.id, 1))
      .run()
    logChange(tx, actor, {
      action: "update",
      entity: "settings",
      summary:
        "Disconnected Interactive Brokers (its accounts and history stay)",
    })
  })
  return getIbkrStatus()
}

/** The daily job: pulls unless not set up, waiting on the person, or blocked by IBKR. */
export async function scheduledIbkrPull(): Promise<void> {
  const r = row()
  const token = getSecret(TOKEN_KEY)
  if (!token || !r.queryId || r.needsPerson || state.running) return
  if (nextAllowedAt(r)) return
  await exclusive(() => pull(token, r.queryId!, false))
}

async function pull(
  token: string,
  queryId: string,
  trial: boolean
): Promise<void> {
  const before = row()
  const allowedAt = nextAllowedAt(before)
  if (allowedAt)
    throw new TooSoon(
      `IBKR allows one pull a minute; the next is allowed ${whenText(allowedAt)}.`,
      allowedAt
    )
  save({ lastPullStartedAt: new Date().toISOString() })
  // After the first report, ask only for the days since the last one, plus an
  // overlap; a new query starts with its own period.
  const days =
    !trial && before.lastReportTo
      ? Math.round(
          (Date.parse(today()) - Date.parse(before.lastReportTo)) / 86_400_000
        ) + OVERLAP_DAYS
      : undefined
  try {
    const xml = await fetchFlexReport({ token, queryId, days }, clientOptions)
    const reports = parseFlexReport(xml, ecbRate)
    if (!reports.length)
      throw new IbkrError(
        "The report has no accounts in it. Check the Flex query's account selection.",
        "stop"
      )
    applyReports(reports)
    const generated = reports
      .map((r) => r.generatedAt)
      .filter((g): g is string => g !== null)
      .sort()
      .at(-1)
    save({
      lastReportAt: generated ?? new Date().toISOString(),
      lastReportTo: reports.map((r) => r.toDate).sort()[0],
      lastPullAt: new Date().toISOString(),
      lastError: null,
      needsPerson: false,
      blockedUntil: null,
      missingSections: JSON.stringify([
        ...new Set(reports.flatMap((r) => r.missing)),
      ]),
    })
  } catch (error) {
    const known = error instanceof IbkrError
    const message = known
      ? error.message
      : "florin couldn't read IBKR's report. Try again later."
    if (!known)
      console.error("florin: IBKR report not applied:", (error as Error).name)
    const blockedUntil =
      known && error.kind === "throttled"
        ? new Date(Date.now() + PULL_SPACING_MS).toISOString()
        : known && error.kind === "blocked"
          ? tomorrow()
          : undefined
    // A failed trial of new credentials leaves the saved connection's state as it was.
    if (!trial)
      save({
        lastPullAt: new Date().toISOString(),
        lastError: message,
        needsPerson: known && error.kind === "stop",
      })
    if (blockedUntil) save({ blockedUntil })
    throw known ? error : new IbkrError(message, "retry")
  }
}

function tomorrow(): string {
  const d = new Date()
  d.setHours(24, 5, 0, 0)
  return d.toISOString()
}

/** Writes each account's report: values, holdings and new transactions, one change line per account. */
export function applyReports(reports: FlexAccountReport[]): void {
  const budget = getSettings().currency
  let foreign = false
  db().transaction((tx) => {
    const existing = tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.provider, "ibkr"))
      .all().length
    for (const report of reports) {
      let account = tx
        .select({
          id: accounts.id,
          name: accounts.name,
          currency: accounts.currency,
        })
        .from(accounts)
        .where(
          and(
            eq(accounts.provider, "ibkr"),
            eq(accounts.externalId, report.accountId)
          )
        )
        .get()
      const created = !account
      if (!account) {
        const name =
          existing + reports.length > 1
            ? `Interactive Brokers ${maskAccountId(report.accountId).slice(1)}`
            : "Interactive Brokers"
        account = tx
          .insert(accounts)
          .values({
            name,
            type: "investment",
            currency: report.currency,
            onBudget: false,
            provider: "ibkr",
            externalId: report.accountId,
            sortOrder: sql`(select coalesce(max(${accounts.sortOrder}), 0) + 1 from ${accounts})`,
          })
          .returning({
            id: accounts.id,
            name: accounts.name,
            currency: accounts.currency,
          })
          .get()
        if (report.currency !== budget) foreign = true
      }
      if (account.currency !== report.currency)
        throw new IbkrError(
          `IBKR now reports account ${maskAccountId(report.accountId)} in ${report.currency}, but florin keeps it in ${account.currency}. Disconnect, rename the old account, and connect again to start a new one.`,
          "stop"
        )
      const accountId = account.id

      for (const v of report.values) {
        tx.insert(accountValues)
          .values({ accountId, date: v.date, value: v.value })
          .onConflictDoUpdate({
            target: [accountValues.accountId, accountValues.date],
            set: { value: v.value },
          })
          .run()
      }

      let holdingCount: number | undefined
      if (report.positions || report.cash) {
        const kept = tx
          .select()
          .from(holdings)
          .where(eq(holdings.accountId, accountId))
          .all()
        const keep = (cash: boolean) =>
          kept.filter((h) => (h.assetClass === "cash") === cash) as Holding[]
        const next = checkHoldings([
          ...(report.positions ?? keep(false)),
          ...(report.cash ?? keep(true)),
        ])
        tx.delete(holdings).where(eq(holdings.accountId, accountId)).run()
        if (next.length)
          tx.insert(holdings)
            .values(next.map((h) => ({ ...h, accountId })))
            .run()
        holdingCount = next.length
      }

      const ids = report.transactions.map((t) => t.importedId)
      const seen = new Set<string>()
      for (let i = 0; i < ids.length; i += 500)
        tx.select({ id: transactions.importedId })
          .from(transactions)
          .where(
            and(
              eq(transactions.accountId, accountId),
              inArray(transactions.importedId, ids.slice(i, i + 500))
            )
          )
          .all()
          .forEach((r) => seen.add(r.id!))
      let added = 0
      for (const t of report.transactions) {
        if (seen.has(t.importedId)) continue
        seen.add(t.importedId)
        tx.insert(transactions)
          .values({
            accountId,
            date: t.date,
            amount: t.amount,
            payeeId: payeeIdForName(t.payee, tx),
            notes: t.notes ?? "",
            importedId: t.importedId,
            importedPayee: t.payee,
          })
          .run()
        added++
      }

      const latest = report.values.at(-1)
      const parts = [
        `${added} new transaction${added === 1 ? "" : "s"}`,
        holdingCount === undefined ? "" : `${holdingCount} holdings`,
        latest
          ? `worth ${money(latest.value, report.currency)} on ${latest.date}`
          : "",
      ].filter(Boolean)
      logChange(tx, "ibkr", {
        action: created ? "create" : "update",
        entity: "account",
        entityId: accountId,
        summary: `${created ? "Added" : "Updated"} ${account.name} from IBKR: ${parts.join(", ")}`,
      })
    }
  })
  if (foreign) runJobSoon("ecb")
}
