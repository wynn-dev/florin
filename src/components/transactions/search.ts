// The Transactions filters: what /transactions keeps in its URL and what the
// table asks the API for. Dates are ISO ("2026-11-12").
import {
  addMonths,
  currentMonth,
  firstDay,
  formatDate,
  lastDay,
} from "@/lib/format"
import type { TransactionFilter } from "@/shared/types"

export type TransactionSearch = {
  search?: string
  accountId?: number
  payeeId?: number
  categoryIds?: number[]
  from?: string
  to?: string
  uncategorized?: boolean
  /** An Activity entry: only the transactions it added or changed. */
  change?: number
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function positiveInt(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : undefined
}

/** Reads /transactions' search params, dropping anything malformed. */
export function validateTransactionSearch(
  raw: Record<string, unknown>
): TransactionSearch {
  const ids = Array.isArray(raw.categoryIds)
    ? raw.categoryIds
    : typeof raw.categoryIds === "string" || typeof raw.categoryIds === "number"
      ? String(raw.categoryIds).split(",")
      : []
  const categoryIds = ids.map(positiveInt).filter((n) => n !== undefined)
  const date = (v: unknown) =>
    typeof v === "string" && ISO_DATE.test(v) ? v : undefined
  return {
    // A search for an amount ("42.10") can arrive parsed as a number.
    search:
      typeof raw.search === "number"
        ? String(raw.search)
        : typeof raw.search === "string" && raw.search.trim()
          ? raw.search
          : undefined,
    accountId: positiveInt(raw.accountId),
    payeeId: positiveInt(raw.payeeId),
    categoryIds: categoryIds.length ? categoryIds : undefined,
    from: date(raw.from),
    to: date(raw.to),
    uncategorized:
      raw.uncategorized === true || raw.uncategorized === "true"
        ? true
        : undefined,
    change: positiveInt(raw.change),
  }
}

export function hasFilters(search: TransactionSearch, scoped = false): boolean {
  return Object.entries(search).some(
    ([key, value]) => value !== undefined && !(scoped && key === "accountId")
  )
}

export function toFilter(
  search: TransactionSearch,
  accountId?: number
): TransactionFilter {
  return {
    search: search.search?.trim() || undefined,
    accountId: accountId ?? search.accountId,
    payeeId: search.payeeId,
    categoryIds: search.categoryIds,
    from: search.from,
    to: search.to,
    uncategorized: search.uncategorized,
    change: search.change,
  }
}

export type DatePreset = { label: string; from?: string; to?: string }

/** The Date filter's presets, as of today. */
export function datePresets(now: Date = new Date()): DatePreset[] {
  const month = currentMonth(now)
  const year = month.slice(0, 4)
  return [
    { label: "This month", from: firstDay(month), to: lastDay(month) },
    {
      label: "Last month",
      from: firstDay(addMonths(month, -1)),
      to: lastDay(addMonths(month, -1)),
    },
    {
      label: "Last 3 months",
      from: firstDay(addMonths(month, -2)),
      to: lastDay(month),
    },
    { label: "This year", from: `${year}-01-01`, to: `${year}-12-31` },
    { label: "All time" },
  ]
}

/** What the Date filter's button reads: a preset's name, or the range ("1 Oct – 12 Nov"). */
export function dateLabel(from?: string, to?: string): string | null {
  if (!from && !to) return null
  const preset = datePresets().find((p) => p.from === from && p.to === to)
  if (preset) return preset.label
  if (from && to)
    return from === to
      ? formatDate(from)
      : `${formatDate(from)} – ${formatDate(to)}`
  return from ? `From ${formatDate(from)}` : `Until ${formatDate(to!)}`
}
