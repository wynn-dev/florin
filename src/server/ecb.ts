// Daily euro reference rates from the ECB, for accounts outside the budget's
// currency. The ECB publishes once per working day around 16:00 CET; the
// "ecb" job (src/server/job-list.ts) checks every 6 hours. It fetches nothing
// while every account is in the budget's currency, keeps only the currencies
// in use, and backfills back to the earliest date florin needs from the
// smallest file that covers it. Rate rows are not written to the change log:
// they aren't changes anyone made to the budget.
import { eq, inArray, max, min, ne, sql } from "drizzle-orm"
import { db, schema } from "./db"
import { getJob } from "./jobs"
import { getSettings, saveFxRates } from "./data"
import { today } from "./data/validate"
import type { FxRate } from "@/shared/types"
import type { FxStatus } from "@/shared/jobs"

export const ECB_JOB = "ecb"
export const ECB_EVERY_MS = 6 * 60 * 60 * 1000

const BASE = "https://www.ecb.europa.eu/stats/eurofxref/"
export const ECB_FILES = {
  daily: "eurofxref-daily.xml",
  "hist-90d": "eurofxref-hist-90d.xml",
  hist: "eurofxref-hist.xml",
} as const
export type EcbFile = keyof typeof ECB_FILES

/** Fetches one ECB file's XML; replaced in tests. */
export type FetchEcb = (file: EcbFile) => Promise<string>

const fetchEcb: FetchEcb = async (file) => {
  const response = await fetch(BASE + ECB_FILES[file], {
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok)
    throw new Error(
      `the ECB answered ${response.status} for ${ECB_FILES[file]}`
    )
  return response.text()
}

/** Every rate in an ECB eurofxref XML file. */
export function parseEcbXml(xml: string): FxRate[] {
  const rates: FxRate[] = []
  let date: string | undefined
  const cube =
    /<Cube\s+(?:time=["'](\d{4}-\d{2}-\d{2})["']|currency=["']([A-Z]{3})["']\s+rate=["']([\d.]+)["'])/g
  for (const [, time, currency, rate] of xml.matchAll(cube)) {
    if (time) date = time
    else if (date) rates.push({ date, currency, rate: Number(rate) })
  }
  if (!rates.length) throw new Error("the ECB file holds no rates")
  return rates
}

/**
 * What florin needs rates for: every account currency other than the
 * budget's, plus the budget's own unless it is EUR (conversions go through
 * the euro), back to the earliest transaction or value of those accounts.
 * No currencies when every account is in the budget's currency.
 */
export function fxNeeds(): { currencies: string[]; earliest: string } {
  const budget = getSettings().currency
  const { accounts, transactions, accountValues } = schema
  const foreign = db()
    .selectDistinct({ currency: accounts.currency })
    .from(accounts)
    .where(ne(accounts.currency, budget))
    .all()
    .map((r) => r.currency)
  if (!foreign.length) return { currencies: [], earliest: today() }
  const currencies = [...new Set([...foreign, budget])]
    .filter((c) => c !== "EUR")
    .sort()
  const ids = sql`(select ${accounts.id} from ${accounts} where ${accounts.currency} <> ${budget})`
  const first = [
    db()
      .select({ d: min(transactions.date) })
      .from(transactions)
      .where(sql`${transactions.accountId} in ${ids}`)
      .get()?.d,
    db()
      .select({ d: min(accountValues.date) })
      .from(accountValues)
      .where(sql`${accountValues.accountId} in ${ids}`)
      .get()?.d,
    today(),
  ].filter((d): d is string => !!d)
  return { currencies, earliest: first.sort()[0] }
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The smallest file that reaches back to `from`: the 90-day file covers about 90 calendar days. */
export function chooseFile(from: string, now = today()): EcbFile {
  return from >= addDays(now, -80) ? "hist-90d" : "hist"
}

/** Whether a Monday–Friday falls in [from, to). */
function weekdayBetween(from: string, to: string): boolean {
  for (let d = from; d < to; d = addDays(d, 1)) {
    const day = new Date(`${d}T00:00:00Z`).getUTCDay()
    if (day !== 0 && day !== 6) return true
  }
  return false
}

function storedRange(currency: string) {
  const { fxRates } = schema
  return db()
    .select({ first: min(fxRates.date), last: max(fxRates.date) })
    .from(fxRates)
    .where(eq(fxRates.currency, currency))
    .get()
}

/**
 * Currencies whose history the ECB's full file starts after the date florin
 * would like (it began in 1999, some currencies later), with the first date
 * it has: so a missing older history doesn't refetch the big file each run.
 */
const historyStarts = new Map<string, string>()

/** Fetches and stores the rates florin needs; see the top of this file. */
export async function refreshRates(
  fetchXml: FetchEcb = fetchEcb
): Promise<void> {
  const { currencies, earliest } = fxNeeds()
  if (!currencies.length) return
  // A week before the earliest date, so a weekend or holiday there still
  // finds an earlier working day's rate.
  const lowest = addDays(earliest, -7)

  // Where each currency's stored rates stop (before today's file adds to them).
  const starts = new Map<string, string>()
  for (const currency of currencies) {
    const { first, last } = storedRange(currency) ?? {}
    const complete =
      first && (first <= earliest || historyStarts.get(currency) === first)
    starts.set(currency, complete && last ? addDays(last, 1) : lowest)
  }

  const daily = parseEcbXml(await fetchXml("daily"))
  const published = new Set(daily.map((r) => r.currency))
  const wanted = currencies.filter((c) => published.has(c))
  const unknown = currencies.filter((c) => !published.has(c))

  // Missing working days before the latest published one: backfill them.
  // Today's rates are stored only after that: stored first, a failed
  // backfill would leave the gap behind them, and the next run would start
  // after it.
  const from = wanted.map((c) => starts.get(c)!).sort()[0]
  if (from && weekdayBetween(from, daily[0].date)) {
    const file = chooseFile(from)
    const rates = parseEcbXml(await fetchXml(file))
    store(rates, wanted, from)
    if (file === "hist") {
      for (const currency of wanted) {
        const first = rates
          .filter((r) => r.currency === currency)
          .reduce<string | undefined>(
            (a, r) => (!a || r.date < a ? r.date : a),
            undefined
          )
        if (first && first > earliest) historyStarts.set(currency, first)
      }
    }
  }
  store(daily, wanted, lowest)

  if (unknown.length)
    throw new Error(`the ECB publishes no rates for ${unknown.join(", ")}`)
}

function store(rates: FxRate[], currencies: string[], from: string): void {
  const keep = new Set(currencies)
  saveFxRates(
    null,
    rates.filter((r) => keep.has(r.currency) && r.date >= from)
  )
}

/** The newest stored rate of each currency florin needs, and how the last refresh went. */
export function fxStatus(): FxStatus {
  const { currencies } = fxNeeds()
  const { fxRates } = schema
  const latest = new Map(
    currencies.length
      ? db()
          .select({ currency: fxRates.currency, date: max(fxRates.date) })
          .from(fxRates)
          .where(inArray(fxRates.currency, currencies))
          .groupBy(fxRates.currency)
          .all()
          .map((r) => [r.currency, r.date])
      : []
  )
  return {
    currencies: currencies.map((currency) => ({
      currency,
      latestDate: latest.get(currency) ?? null,
    })),
    job: getJob(ECB_JOB),
  }
}
