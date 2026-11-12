// Reads an Activity Flex report (XML) into what florin stores for each IBKR
// account in it: daily values from NAV in Base, holdings from Open Positions
// (summary rows) and the Cash Report, and transactions from Trades and Cash
// Transactions. Every amount ends up in the account's base currency, in minor
// units, converted with the row's own fxRateToBase.
//
// Privacy: the Account Information section also carries the holder's name,
// address, email and date of birth. Only its accountId and currency are read;
// nothing else from it is kept, and errors never quote report content.
import { createHash } from "node:crypto"
import { minorDigits } from "../data/fx"
import { isBlank, mulToMinor, toMinor, toNumber } from "./decimal"
import { FlexQueryError, MissingSectionError } from "./errors"
import { childNamed, childrenNamed, parseXml } from "./xml"
import type { XmlElement } from "./xml"
import type { FlexSection } from "@/shared/ibkr"
import type {
  AccountValue,
  AssetClass,
  Holding,
  ImportRow,
} from "@/shared/types"

export type FlexAccountReport = {
  /** IBKR's account id, e.g. "U1234567". */
  accountId: string
  /** The account's base currency. */
  currency: string
  fromDate: string
  toDate: string
  /** When IBKR generated the report (ISO, UTC); null if it didn't say. */
  generatedAt: string | null
  /** Sections the query lacks, apart from Account Information. */
  missing: FlexSection[]
  /** NAV total per reported day. */
  values: AccountValue[]
  /** Positions and cash; null when the query has neither section. */
  positions: Holding[] | null
  /** Cash per currency; null without the Cash Report section. */
  cash: Holding[] | null
  /** Trades and cash movements, oldest first; importedId is IBKR's transactionID. */
  transactions: (ImportRow & { importedId: string })[]
}

const SECTIONS: [string, FlexSection][] = [
  ["EquitySummaryInBase", "Net Asset Value (NAV) in Base"],
  ["CashReport", "Cash Report"],
  ["OpenPositions", "Open Positions"],
  ["Trades", "Trades"],
  ["CashTransactions", "Cash Transactions"],
]

/**
 * A currency's rate to the account's base currency on a date, as a decimal
 * string, from outside the report (florin's ECB rates); null when unknown.
 */
export type OutsideRate = (
  currency: string,
  base: string,
  date: string
) => string | null

export function parseFlexReport(
  xml: string,
  outsideRate: OutsideRate = () => null
): FlexAccountReport[] {
  let root: XmlElement
  try {
    root = parseXml(xml)
  } catch {
    throw new FlexQueryError(
      "IBKR's report isn't readable XML. Set the Flex query's format to XML."
    )
  }
  if (root.name !== "FlexQueryResponse")
    throw new FlexQueryError(
      "IBKR's answer isn't an Activity Flex report. Check that the query is an Activity Flex Query in XML."
    )
  const statements = childrenNamed(root, "FlexStatements").flatMap((s) =>
    childrenNamed(s, "FlexStatement")
  )
  return statements.map((s) => readStatement(s, outsideRate))
}

function readStatement(
  statement: XmlElement,
  outsideRate: OutsideRate
): FlexAccountReport {
  const info = childNamed(statement, "AccountInformation")
  const nav = childNamed(statement, "EquitySummaryInBase")
  if (!nav) throw new MissingSectionError("Net Asset Value (NAV) in Base")
  const navRows = childrenNamed(nav, "EquitySummaryByReportDateInBase")
  const accountId = statement.attrs.accountId || info?.attrs.accountId || ""
  if (!accountId)
    throw new FlexQueryError(
      "IBKR's report doesn't say which account it is for."
    )
  const currency =
    (info && !isBlank(info.attrs.currency) && info.attrs.currency) ||
    navRows.find((r) => !isBlank(r.attrs.currency))?.attrs.currency
  if (!currency || !/^[A-Z]{3}$/.test(currency))
    throw new MissingSectionError("Account Information")
  const digits = minorDigits(currency)
  const rates = latestRates(statement)
  const ctx: Ctx = {
    currency,
    digits,
    rateOf: (other, date) => {
      if (other === currency) return "1"
      const rate = rates.get(other) ?? outsideRate(other, currency, date)
      if (rate === null)
        throw new FlexQueryError(
          `IBKR's report has ${other} amounts but no exchange rate from ${other} to ${currency}. Add the Conversion Rates section to the Flex query.`
        )
      return rate
    },
  }

  const missing = SECTIONS.filter(([el]) => !childNamed(statement, el)).map(
    ([, section]) => section
  )

  const values = navRows.map((r) => ({
    date: flexDate(r.attrs.reportDate),
    value: toMinor(r.attrs.total, digits, "NAV total"),
  }))

  const openPositions = childNamed(statement, "OpenPositions")
  const cashReport = childNamed(statement, "CashReport")
  const trades = childNamed(statement, "Trades")
  const cashTransactions = childNamed(statement, "CashTransactions")
  const transactions = [
    ...(trades
      ? childrenNamed(trades, "Trade").flatMap((t) => readTrade(t, ctx))
      : []),
    ...(cashTransactions
      ? childrenNamed(cashTransactions, "CashTransaction").flatMap((t) =>
          readCashTransaction(t, ctx)
        )
      : []),
  ].sort((a, b) => a.date.localeCompare(b.date))

  return {
    accountId,
    currency,
    fromDate: flexDate(statement.attrs.fromDate),
    toDate: flexDate(statement.attrs.toDate),
    generatedAt: isBlank(statement.attrs.whenGenerated)
      ? null
      : flexTimestamp(statement.attrs.whenGenerated),
    missing,
    values,
    positions: openPositions ? readPositions(openPositions, ctx) : null,
    cash: cashReport ? readCash(cashReport, statement, ctx) : null,
    transactions,
  }
}

type Ctx = {
  currency: string
  digits: number
  /** A currency's rate to base: the report's own first, then florin's ECB rates. */
  rateOf: (currency: string, date: string) => string
}

// ---------------------------------------------------------------- dates

/**
 * A Flex date as YYYY-MM-DD. IBKR's default is yyyyMMdd; yyyy-MM-dd is also
 * accepted. A time after it (";HHmmss") is ignored: florin keeps the date as
 * IBKR reports it, with no time zone conversion.
 */
export function flexDate(value: string | undefined): string {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})(?:$|[;, T]|\d{2}:?\d{2})/.exec(
    value ?? ""
  )
  if (!m)
    throw new FlexQueryError(
      "IBKR sent dates in a format florin doesn't read. In the Flex query's General Configuration, set Date Format to yyyyMMdd."
    )
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** "20261112;031544" (US Eastern time, as IBKR reports) → an ISO timestamp in UTC. */
export function flexTimestamp(value: string): string {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})[;, T]?(\d{2}):?(\d{2}):?(\d{2})/.exec(
    value
  )
  if (!m) return `${flexDate(value)}T00:00:00.000Z`
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(guess)
      .map((p) => [p.type, Number(p.value)])
  )
  const asEastern = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  return new Date(guess - (asEastern - guess)).toISOString()
}

// ---------------------------------------------------------------- money text

/** Money for notes, independent of the server's locale: "€5,000.00", "US$5,412.50", "−€6.59". */
export function moneyText(amount: string, currency: string): string {
  const digits = minorDigits(currency)
  const minor = toMinor(amount, digits)
  return new Intl.NumberFormat("en-GB", { style: "currency", currency })
    .format(minor / 10 ** digits)
    .replace("-", "−")
}

/** A plain number without trailing zeros: "10", "0.5". */
function quantityText(value: string): string {
  return String(Math.abs(toNumber(value, "quantity")))
}

function rateToBase(
  row: XmlElement,
  ctx: Ctx,
  currency = row.attrs.currency
): string {
  if (currency === ctx.currency) return "1"
  const rate = row.attrs.fxRateToBase
  if (isBlank(rate))
    throw new FlexQueryError(
      `IBKR's report has a ${currency} row without its exchange rate to ${ctx.currency}.`
    )
  return rate
}

// ---------------------------------------------------------------- holdings

function assetClass(category: string, subCategory: string): AssetClass {
  if (category === "STK") return subCategory === "ETF" ? "etf" : "stock"
  if (category === "BOND" || category === "BILL") return "bond"
  if (category === "CASH") return "cash"
  return "other"
}

type Lot = {
  attrs: Record<string, string>
  quantity: string[]
  value: string[]
  cost: string[]
  pnl: string[]
}

/**
 * One holding per instrument from the summary rows. A query set to lots only
 * has no summary rows; then the lots are added up per instrument.
 */
function readPositions(section: XmlElement, ctx: Ctx): Holding[] {
  const rows = childrenNamed(section, "OpenPosition")
  const summary = rows.filter(
    (r) => !r.attrs.levelOfDetail || r.attrs.levelOfDetail === "SUMMARY"
  )
  const groups = new Map<string, Lot>()
  for (const r of summary.length
    ? summary
    : rows.filter((x) => x.attrs.levelOfDetail === "LOT")) {
    const key = r.attrs.conid || r.attrs.symbol
    const lot = groups.get(key) ?? {
      attrs: r.attrs,
      quantity: [],
      value: [],
      cost: [],
      pnl: [],
    }
    lot.quantity.push(r.attrs.position)
    lot.value.push(r.attrs.positionValue)
    lot.cost.push(r.attrs.costBasisMoney)
    lot.pnl.push(r.attrs.fifoPnlUnrealized)
    groups.set(key, lot)
  }
  const used = new Set<string>()
  const holdings: Holding[] = []
  for (const { attrs, quantity, value, cost, pnl } of groups.values()) {
    const rate = rateToBase({ name: "", attrs, children: [], text: "" }, ctx)
    const sum = (values: string[], field: string) =>
      values.some(isBlank)
        ? null
        : values.reduce((s, v) => s + mulToMinor(v, rate, ctx.digits, field), 0)
    let symbol = attrs.symbol || attrs.conid
    if (used.has(symbol)) symbol = `${symbol} (${attrs.conid})`
    used.add(symbol)
    holdings.push({
      symbol,
      name: attrs.description || symbol,
      assetClass: assetClass(attrs.assetCategory, attrs.subCategory),
      quantity: quantity.reduce((s, q) => s + toNumber(q, "position"), 0),
      price: isBlank(attrs.markPrice)
        ? 0
        : toNumber(attrs.markPrice, "markPrice"),
      value: sum(value, "positionValue") ?? 0,
      costBasis: sum(cost, "costBasisMoney"),
      unrealizedPnl: sum(pnl, "fifoPnlUnrealized"),
      currency: attrs.currency || ctx.currency,
      asOf: flexDate(attrs.reportDate || ""),
    })
  }
  return holdings
}

/**
 * One cash holding per currency from the Cash Report. Its base-currency
 * value: the base currency's own cash as is; with one other currency, the
 * base summary minus the base cash (exact); otherwise the newest rate to
 * base for that currency seen elsewhere in the report.
 */
function readCash(
  section: XmlElement,
  statement: XmlElement,
  ctx: Ctx
): Holding[] {
  const rows = childrenNamed(section, "CashReportCurrency")
  const summary = rows.find((r) => r.attrs.currency === "BASE_SUMMARY")
  const perCurrency = rows.filter(
    (r) => r.attrs.currency !== "BASE_SUMMARY" && !isBlank(r.attrs.endingCash)
  )
  const asOf = flexDate(statement.attrs.toDate)
  const foreign = perCurrency.filter((r) => r.attrs.currency !== ctx.currency)
  const baseCash = perCurrency.find((r) => r.attrs.currency === ctx.currency)
  return perCurrency
    .map((r) => {
      const currency = r.attrs.currency
      const amount = r.attrs.endingCash
      let value: number
      if (currency === ctx.currency)
        value = toMinor(amount, ctx.digits, "endingCash")
      else if (
        foreign.length === 1 &&
        summary &&
        !isBlank(summary.attrs.endingCash)
      )
        value =
          toMinor(summary.attrs.endingCash, ctx.digits, "endingCash") -
          (baseCash
            ? toMinor(baseCash.attrs.endingCash, ctx.digits, "endingCash")
            : 0)
      else
        value = mulToMinor(
          amount,
          ctx.rateOf(currency, asOf),
          ctx.digits,
          "endingCash"
        )
      return {
        symbol: currency,
        name: `${currency} cash`,
        assetClass: "cash" as const,
        quantity: toNumber(amount, "endingCash"),
        price: 1,
        value,
        costBasis: null,
        unrealizedPnl: null,
        currency,
        asOf,
      }
    })
    .filter((h) => h.quantity !== 0)
}

/**
 * The newest rate to base per currency among the report's rows (their
 * fxRateToBase), and its Conversion Rates section where the query has one.
 */
function latestRates(statement: XmlElement): Map<string, string> {
  const rows = ["Trades", "CashTransactions", "OpenPositions"].flatMap(
    (s) => childNamed(statement, s)?.children ?? []
  )
  const best = new Map<string, { date: string; rate: string }>()
  for (const r of rows) {
    const { currency, fxRateToBase } = r.attrs
    if (!currency || isBlank(fxRateToBase)) continue
    const date = r.attrs.dateTime || r.attrs.reportDate || ""
    const seen = best.get(currency)
    if (!seen || date > seen.date)
      best.set(currency, { date, rate: fxRateToBase })
  }
  const base = childNamed(statement, "AccountInformation")?.attrs.currency ?? ""
  for (const r of childNamed(statement, "ConversionRates")?.children ?? []) {
    const { fromCurrency, toCurrency, rate } = r.attrs
    if (!fromCurrency || isBlank(rate) || (base && toCurrency !== base))
      continue
    const date = r.attrs.reportDate || ""
    const seen = best.get(fromCurrency)
    if (!seen || date > seen.date) best.set(fromCurrency, { date, rate })
  }
  return new Map([...best].map(([c, v]) => [c, v.rate]))
}

// ---------------------------------------------------------------- transactions

function importedId(row: XmlElement): string {
  if (!isBlank(row.attrs.transactionID)) return row.attrs.transactionID
  const { reportDate: _, ...rest } = row.attrs
  return (
    "ibkr:" +
    createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 24)
  )
}

/** One transaction per executed trade; a currency conversion is one row of its own kind. */
function readTrade(
  row: XmlElement,
  ctx: Ctx
): (ImportRow & { importedId: string })[] {
  const a = row.attrs
  if (a.levelOfDetail && a.levelOfDetail !== "EXECUTION") return []
  if (a.transactionType === "TradeCancel" || /\(Ca\.\)/.test(a.buySell ?? ""))
    return []
  const date = flexDate(a.tradeDate || a.dateTime)
  const rate = rateToBase(row, ctx)
  const commission = isBlank(a.ibCommission) ? "0" : a.ibCommission
  const commissionCurrency = a.ibCommissionCurrency || a.currency
  const commissionRate =
    commissionCurrency === a.currency
      ? rate
      : ctx.rateOf(commissionCurrency, date)

  if (a.assetCategory === "CASH") {
    // EUR.USD: quantity is in EUR (the first currency), proceeds in USD (the row's).
    const [first, second = a.currency] = (a.symbol || "").split(".")
    const firstAmount = a.quantity.replace(/^[+-]/, "")
    const secondAmount = a.proceeds.replace(/^[+-]/, "")
    const soldFirst = a.quantity.trim().startsWith("-")
    const from = soldFirst
      ? moneyText(firstAmount, first)
      : moneyText(secondAmount, second)
    const to = soldFirst
      ? moneyText(secondAmount, second)
      : moneyText(firstAmount, first)
    const fee =
      toMinor(commission, minorDigits(commissionCurrency)) !== 0
        ? ` · fee ${moneyText(commission.replace(/^-/, ""), commissionCurrency)}`
        : ""
    return [
      {
        importedId: importedId(row),
        date,
        // A conversion moves money between currencies inside the account;
        // only its fee changes what the account is worth.
        amount: mulToMinor(
          commission,
          commissionRate,
          ctx.digits,
          "ibCommission"
        ),
        payee: "Currency conversion",
        notes: `${from} → ${to} · ${a.tradePrice}${fee}`,
      },
    ]
  }

  const quantity = toNumber(a.quantity, "quantity")
  const net = isBlank(a.netCash) ? a.proceeds : a.netCash
  const notes = [
    `${quantityText(a.quantity)} × ${moneyText(a.tradePrice, a.currency)}`,
    toMinor(commission, minorDigits(commissionCurrency)) !== 0
      ? `fee ${moneyText(commission.replace(/^-/, ""), commissionCurrency)}`
      : "",
    a.currency !== ctx.currency
      ? `${moneyText(net, a.currency)} · ${rate}`
      : "",
  ].filter(Boolean)
  return [
    {
      importedId: importedId(row),
      date,
      amount: mulToMinor(net, rate, ctx.digits, "netCash"),
      payee: `${quantity < 0 ? "Sold" : "Bought"} ${quantityText(a.quantity)} ${a.symbol}`,
      notes: notes.join(" · "),
    },
  ]
}

const CASH_PAYEES: Record<string, string> = {
  "Broker Interest Received": "Interest",
  "Broker Interest Paid": "Interest",
  "Bond Interest Received": "Bond interest",
  "Bond Interest Paid": "Bond interest",
  "Other Fees": "Fees",
  "Advisor Fees": "Advisor fees",
  "Commission Adjustments": "Commission adjustment",
}

/** Dividends, withholding tax, interest, fees, deposits and withdrawals. */
function readCashTransaction(
  row: XmlElement,
  ctx: Ctx
): (ImportRow & { importedId: string })[] {
  const a = row.attrs
  if (a.levelOfDetail && a.levelOfDetail !== "DETAIL") return []
  const type = a.type ?? ""
  const rate = rateToBase(row, ctx)
  const positive = !a.amount.trim().startsWith("-")
  const transfer =
    type === "Deposits/Withdrawals" || type === "Deposits & Withdrawals"
  const payee = transfer
    ? positive
      ? "Deposit"
      : "Withdrawal"
    : type === "Dividends" || type === "Payment In Lieu Of Dividends"
      ? `${a.symbol} dividend`.trim()
      : type === "Withholding Tax"
        ? `${a.symbol} withholding tax`.trim()
        : (CASH_PAYEES[type] ?? type ?? "Interactive Brokers")
  // A transfer's description can name the account holder, so it isn't kept.
  const notes = [
    transfer ? "" : (a.description ?? "").trim(),
    a.currency !== ctx.currency
      ? `${moneyText(a.amount, a.currency)} · ${rate}`
      : "",
  ].filter(Boolean)
  return [
    {
      importedId: importedId(row),
      date: flexDate(a.dateTime || a.reportDate),
      amount: mulToMinor(a.amount, rate, ctx.digits, "amount"),
      payee,
      notes: notes.join(" · "),
    },
  ]
}
