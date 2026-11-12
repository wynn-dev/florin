// Every number, amount and date the dashboard shows goes through here, so
// pages never call Intl themselves. Amounts are integer minor units in an
// explicit currency; dates are ISO strings ("2026-11-12", months "2026-11").
//
// The locale is one setting for the whole app: numbers, money and dates
// follow it, while words stay English ("2 hr ago", "Today"). It defaults to
// en-GB, which gives the plan's "12 Nov" and "US$52,310". The time zone is
// one setting too ("today", "this month", times of day). Both are set the same
// on the server and in the browser, so server-rendered text matches.

let locale = "en-GB"
let timeZone: string | undefined

/** Sets the locale every formatter uses, e.g. from the person's settings. */
export function setLocale(next: string): void {
  if (next === locale) return
  locale = next
  clearFormats()
}

export function getLocale(): string {
  return locale
}

/** Sets the time zone "today" and times of day are in; undefined for the runtime's own. */
export function setTimeZone(next: string | undefined): void {
  if (next === timeZone) return
  timeZone = next
  clearFormats()
}

function clearFormats() {
  numberFormats.clear()
  dateFormats.clear()
  relativeFormats.clear()
}

/** English in the locale's region ("en-DE" for de-DE), for words that stay English. */
function englishLocale(): string {
  try {
    const region = new Intl.Locale(locale).maximize().region
    return region ? `en-${region}` : "en-GB"
  } catch {
    return "en-GB"
  }
}

const MINUS = "−"

// ---------------------------------------------------------------- money

const numberFormats = new Map<string, Intl.NumberFormat>()

function numberFormat(
  key: string,
  options: Intl.NumberFormatOptions
): Intl.NumberFormat {
  let format = numberFormats.get(key)
  if (!format) {
    format = new Intl.NumberFormat(locale, options)
    numberFormats.set(key, format)
  }
  return format
}

/** How many decimals the currency has: 2 for EUR and USD, 0 for JPY. */
export function currencyDigits(currency: string): number {
  return (
    numberFormat(`digits:${currency}`, {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  )
}

/** The currency's symbol in the current locale: "€", "US$", "JP¥". */
export function currencySymbol(currency: string): string {
  return (
    numberFormat(`symbol:${currency}`, {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
    })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? currency
  )
}

export type MoneyOptions = {
  /** Always show the sign: "+1,200.00" / "−42.10". Use for transaction amounts. */
  signed?: boolean
  /** False drops the currency symbol, for a column that is all one currency. */
  symbol?: boolean
  /** Short form for axis ticks: "€12k". */
  compact?: boolean
  /** Rounded to whole units: "≈ €48,140" beside a figure in another currency. */
  whole?: boolean
}

/** Formats integer minor units as money: formatMoney(-4210, "EUR") → "−€42.10". */
export function formatMoney(
  cents: number,
  currency: string,
  options: MoneyOptions = {}
): string {
  const {
    signed = false,
    symbol = true,
    compact = false,
    whole = false,
  } = options
  const digits = currencyDigits(currency)
  const key = `money:${currency}:${signed}:${symbol}:${compact}:${whole}`
  const format = numberFormat(key, {
    ...(symbol
      ? { style: "currency", currency, currencyDisplay: "symbol" }
      : {
          style: "decimal",
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }),
    ...(compact
      ? {
          notation: "compact",
          minimumFractionDigits: 0,
          maximumFractionDigits: 1,
        }
      : whole
        ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
        : {}),
    signDisplay: signed ? "exceptZero" : "auto",
  })
  return format.format(cents / 10 ** digits).replace(/-/g, MINUS)
}

/** What is left: "€120.00", or for a category that went over "€618.60 over". */
export function formatLeft(available: number, currency: string): string {
  return available < 0
    ? `${formatMoney(-available, currency)} over`
    : formatMoney(available, currency)
}

/** "46%" from 0.46; signed gives "+12%" / "−3%". */
export function formatPercent(
  ratio: number,
  options: { signed?: boolean; digits?: number } = {}
): string {
  const { signed = false, digits = 0 } = options
  return numberFormat(`percent:${signed}:${digits}`, {
    style: "percent",
    maximumFractionDigits: digits,
    signDisplay: signed ? "exceptZero" : "auto",
  })
    .format(ratio)
    .replace(/-/g, MINUS)
}

/** A plain quantity, grouped, with up to `digits` decimals: 1204.5 → "1,204.5". */
export function formatQuantity(value: number, digits = 4): string {
  return numberFormat(`quantity:${digits}`, {
    maximumFractionDigits: digits,
  })
    .format(value)
    .replace(/-/g, MINUS)
}

/** Minor units as an editable plain number, unsigned and ungrouped: 4210 → "42.10". */
export function formatAmountInput(cents: number, currency: string): string {
  const digits = currencyDigits(currency)
  const decimal = decimalSeparator()
  return (Math.abs(cents) / 10 ** digits).toFixed(digits).replace(".", decimal)
}

function decimalSeparator(): string {
  return (
    numberFormat("decimal", {})
      .formatToParts(1.5)
      .find((part) => part.type === "decimal")?.value ?? "."
  )
}

/**
 * Reads a plain number the person typed ("42.1", "1,200.50", "12,50") as
 * unsigned minor units, or null when it isn't one. The locale's decimal
 * separator wins; the other one counts as the decimal point only when it
 * appears once with no more digits after it than the currency has.
 */
export function parseAmount(text: string, currency: string): number | null {
  const digits = currencyDigits(currency)
  const clean = text.replace(/[\s\u00a0\u202f']/g, "")
  const decimal = decimalSeparator()
  const other = decimal === "." ? "," : "."
  let point: string | null = clean.includes(decimal) ? decimal : null
  if (!point) {
    const parts = clean.split(other)
    if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= digits)
      point = other
  }
  // Whichever separator isn't the decimal point is grouping, and goes.
  const grouping = point === other ? decimal : other
  const [whole, fraction = "", ...rest] = clean
    .split(grouping)
    .join("")
    .split(point ?? grouping)
  if (rest.length || !/^\d*$/.test(whole) || !/^\d*$/.test(fraction))
    return null
  if ((whole === "" && fraction === "") || fraction.length > digits) return null
  const minor =
    Number(whole || "0") * 10 ** digits + Number(fraction.padEnd(digits, "0"))
  return Number.isSafeInteger(minor) ? minor : null
}

// ---------------------------------------------------------------- ISO dates

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

function isoDate(date: Date): string {
  if (!timeZone)
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  // Latin digits whatever the locale: this is an ISO date, not display text.
  let format = dateFormats.get("iso")
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    })
    dateFormats.set("iso", format)
  }
  const parts = format.formatToParts(date)
  const part = (type: string) => parts.find((p) => p.type === type)?.value
  return `${part("year")}-${part("month")}-${part("day")}`
}

/** Today in the person's time zone (else the runtime's): "2026-11-12". */
export function today(now: Date = new Date()): string {
  return isoDate(now)
}

/** This month in the person's time zone: "2026-11". */
export function currentMonth(now: Date = new Date()): string {
  return isoDate(now).slice(0, 7)
}

/** The month a date falls in: "2026-11-12" → "2026-11". */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** Moves a month by n months: addMonths("2026-11", 2) → "2027-01". */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number)
  const index = y * 12 + (m - 1) + n
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`
}

/** The first day of a month: "2026-11" → "2026-11-01". */
export function firstDay(month: string): string {
  return `${month}-01`
}

/** The last day of a month: "2026-02" → "2026-02-28". */
export function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`
}

/** Moves a date by n days: addDays("2026-11-30", 1) → "2026-12-01". */
export function addDays(date: string, n: number): string {
  const d = utc(date)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function utc(date: string): Date {
  return new Date(`${date.length === 7 ? `${date}-01` : date}T00:00:00Z`)
}

// ---------------------------------------------------------------- display dates

const dateFormats = new Map<string, Intl.DateTimeFormat>()

function dateFormat(
  key: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  let format = dateFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options)
    dateFormats.set(key, format)
  }
  return format
}

/** A row's date: "12 Nov", or "12 Nov 2025" when not in the current year. */
export function formatDate(date: string, now: Date = new Date()): string {
  const sameYear = date.slice(0, 4) === today(now).slice(0, 4)
  return dateFormat(sameYear ? "day" : "day-year", {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(utc(date))
}

/** A day heading in a list: "Today", "Yesterday", "Tue 10 Nov" (plus the year when not current). */
export function formatDayHeading(date: string, now: Date = new Date()): string {
  if (date === today(now)) return "Today"
  if (date === addDays(today(now), -1)) return "Yesterday"
  const sameYear = date.slice(0, 4) === today(now).slice(0, 4)
  return dateFormat(sameYear ? "weekday" : "weekday-year", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  })
    .format(utc(date))
    .replace(",", "")
}

/** A month heading: "2026-11" → "November 2026". */
export function formatMonth(month: string): string {
  return dateFormat("month", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utc(month))
}

/**
 * An axis tick for a month or a date in it: "Nov", with the year at January
 * ("Jan 2026"). Pass `withYear` to force the year, e.g. on the first tick.
 */
export function formatMonthTick(monthOrDate: string, withYear = false): string {
  const year = withYear || monthOrDate.slice(5, 7) === "01"
  return dateFormat(year ? "tick-year" : "tick", {
    month: "short",
    year: year ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(utc(monthOrDate.slice(0, 7)))
}

/** A month's short name alone, for a month or a date in it: "Jan". */
export function formatMonthShort(monthOrDate: string): string {
  return dateFormat("month-short", { month: "short", timeZone: "UTC" }).format(
    utc(monthOrDate.slice(0, 7))
  )
}

/** An absolute timestamp for a tooltip: "12 Nov 2026, 09:30". */
export function formatDateTime(iso: string): string {
  return dateFormat("datetime", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso))
}

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>()

/**
 * A timestamp relative to now: "just now", "12 min ago", "2 hr ago",
 * "yesterday", "3 days ago", "in 5 days"; past a week, the date ("12 Nov").
 * Only for sync times, report times and Activity, with formatDateTime in a
 * tooltip.
 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const seconds = Math.round((then.getTime() - now.getTime()) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return "just now"
  let format = relativeFormats.get("short")
  if (!format) {
    format = new Intl.RelativeTimeFormat(englishLocale(), {
      numeric: "auto",
      style: "short",
    })
    relativeFormats.set("short", format)
  }
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute")
  if (abs < 6 * 3600) return format.format(Math.round(seconds / 3600), "hour")
  // Past a few hours, count calendar days so 23:50 yesterday reads "yesterday".
  const days = Math.round(
    (utc(isoDate(then)).getTime() - utc(isoDate(now)).getTime()) / 86_400_000
  )
  if (days === 0) return format.format(Math.round(seconds / 3600), "hour")
  if (Math.abs(days) <= 7) return format.format(days, "day")
  return formatDate(isoDate(then), now)
}

/** A day and time for a label: "12 Nov 09:30" (the year too when not this year). */
export function formatDayTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  return `${formatDate(isoDate(then), now)} ${formatTime(iso)}`
}

/** The time of day alone: "09:30". */
export function formatTime(iso: string): string {
  return dateFormat("time", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso))
}

// ---------------------------------------------------------------- server text

const STORED_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "JPY",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "CAD",
  "AUD",
]
let storedAmount: { pattern: RegExp; currencies: Map<string, string> } | null =
  null

/**
 * Re-formats the amounts in text the server wrote once in English
 * ("Moved €1,234.50 from …", "−CHF 40.00") in the person's locale, so a
 * change summary reads like the rest of the page ("Moved 1.234,50 € …").
 */
export function localiseAmounts(text: string): string {
  if (!storedAmount) {
    const currencies = new Map<string, string>()
    for (const currency of STORED_CURRENCIES) {
      const prefix = new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      })
        .formatToParts(1)
        .filter((p) => p.type === "currency" || p.type === "literal")
        .map((p) => p.value)
        .join("")
      currencies.set(prefix.trim(), currency)
    }
    const symbols = [...currencies.keys()]
      .sort((a, b) => b.length - a.length)
      .map((s) => s.replace(/[$^*+?.()|[\]{}\\]/g, "\\$&"))
    storedAmount = {
      pattern: new RegExp(
        `([−-]?)(${symbols.join("|")})[\\s\\u00a0]?(\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?)(?![\\d.,]*\\d)`,
        "g"
      ),
      currencies,
    }
  }
  const { pattern, currencies } = storedAmount
  return text.replace(pattern, (whole, sign: string, symbol: string, n) => {
    const currency = currencies.get(symbol)
    if (!currency) return whole
    const digits = currencyDigits(currency)
    const [int, frac = ""] = String(n).replace(/,/g, "").split(".")
    if (frac.length > digits) return whole
    const minor =
      Number(int) * 10 ** digits + Number(frac.padEnd(digits, "0") || 0)
    return formatMoney(sign ? -minor : minor, currency)
  })
}
