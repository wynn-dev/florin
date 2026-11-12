// Currency conversion for accounts outside the budget's currency. Rates are
// stored the way the ECB publishes them: units of a currency per 1 EUR.
import { and, desc, eq, gte, lte, sql } from "drizzle-orm"
import { db, schema } from "../db"
import { logChange } from "./changes"
import { checkDate, InvalidInput } from "./validate"
import type { Actor, FxRate } from "@/shared/types"

const { fxRates } = schema

/** Digits after the decimal point in a currency's minor unit (2 for EUR, 0 for JPY). */
export function minorDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  )
}

export function checkCurrency(value: unknown, field = "currency"): string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    throw new InvalidInput(`${field} must be an ISO 4217 code such as EUR`)
  }
  return value
}

/** Units of `currency` per 1 EUR on `date`, using the latest rate on or before it; null if none. */
export function rateOn(currency: string, date: string): number | null {
  if (currency === "EUR") return 1
  const row = db()
    .select({ rate: fxRates.rate })
    .from(fxRates)
    .where(and(eq(fxRates.currency, currency), lte(fxRates.date, date)))
    .orderBy(desc(fxRates.date))
    .limit(1)
    .get()
  return row?.rate ?? null
}

/**
 * Converts an amount in minor units from one currency to another at the rates
 * on `date`. Returns null when either rate is missing.
 */
export function convert(
  amount: number,
  from: string,
  to: string,
  date: string
): number | null {
  if (from === to) return amount
  const fromRate = rateOn(from, date)
  const toRate = rateOn(to, date)
  if (fromRate === null || toRate === null) return null
  const major = amount / 10 ** minorDigits(from)
  return Math.round((major / fromRate) * toRate * 10 ** minorDigits(to))
}

/**
 * Stores rates (replacing any for the same currency and date). A null actor
 * (the ECB refresh) leaves no line in the change log.
 */
export function saveFxRates(actor: Actor | null, rates: FxRate[]): void {
  db().transaction((tx) => {
    for (const r of rates) {
      checkDate(r.date)
      checkCurrency(r.currency)
      if (!(r.rate > 0))
        throw new InvalidInput("rate must be a positive number")
      tx.insert(fxRates)
        .values(r)
        .onConflictDoUpdate({
          target: [fxRates.currency, fxRates.date],
          set: { rate: r.rate },
        })
        .run()
    }
    if (actor && rates.length) {
      const currencies = [...new Set(rates.map((r) => r.currency))].join(", ")
      logChange(tx, actor, {
        action: "update",
        entity: "fx rate",
        summary: `Saved ${rates.length} exchange rates for ${currencies}`,
      })
    }
  })
}

/**
 * Stored rates, newest first: for one currency over a date range, or without
 * a currency the latest rate of each.
 */
export function listFxRates(
  options: {
    currency?: string
    from?: string
    to?: string
    limit?: number
  } = {}
): FxRate[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000)
  const where = and(
    options.currency === undefined
      ? sql`${fxRates.date} = (select max(r.date) from ${fxRates} r where r.currency = ${fxRates.currency})`
      : eq(fxRates.currency, checkCurrency(options.currency)),
    options.from === undefined
      ? undefined
      : gte(fxRates.date, checkDate(options.from, "from")),
    options.to === undefined
      ? undefined
      : lte(fxRates.date, checkDate(options.to, "to"))
  )
  return db()
    .select({
      date: fxRates.date,
      currency: fxRates.currency,
      rate: fxRates.rate,
    })
    .from(fxRates)
    .where(where)
    .orderBy(desc(fxRates.date), fxRates.currency)
    .limit(limit)
    .all()
}
