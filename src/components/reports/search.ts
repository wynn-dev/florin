// The Reports filter row lives in the URL: ?range=6m, ?range=custom&from=…&to=…,
// ?accounts=[1,2], and for Spending ?group=<id> when drilled into a group.
// The default (last 12 months, all accounts) leaves the URL bare.
import type { ReportQuery } from "@/shared/reports"
import { addMonths, currentMonth, lastDay, today } from "@/lib/format"

export const REPORTS = [
  { id: "net-worth", label: "Net worth" },
  { id: "spending", label: "Spending" },
  { id: "income-expenses", label: "Income & expenses" },
  { id: "cash-flow", label: "Cash flow" },
] as const

export type ReportId = (typeof REPORTS)[number]["id"]

export const RANGES = [
  { id: "3m", label: "Last 3 months" },
  { id: "6m", label: "Last 6 months" },
  { id: "12m", label: "Last 12 months" },
  { id: "this-year", label: "This year" },
  { id: "last-year", label: "Last year" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom…" },
] as const

export type RangeId = (typeof RANGES)[number]["id"]

export type ReportSearch = {
  range?: RangeId
  from?: string
  to?: string
  accounts?: number[]
  /** Spending's drill-down: a group id, or 0 for spending without a category. */
  group?: number
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function validateReportSearch(
  search: Record<string, unknown>
): ReportSearch {
  const range = RANGES.find((r) => r.id === search.range)?.id
  const date = (value: unknown) =>
    typeof value === "string" && DATE.test(value) ? value : undefined
  const accounts = Array.isArray(search.accounts)
    ? search.accounts.filter(
        (id): id is number => Number.isSafeInteger(id) && id > 0
      )
    : []
  const group = Number(search.group)
  return {
    range: range === "12m" ? undefined : range,
    from: range === "custom" ? date(search.from) : undefined,
    to: range === "custom" ? date(search.to) : undefined,
    accounts: accounts.length ? accounts : undefined,
    group:
      search.group !== undefined && Number.isSafeInteger(group) && group >= 0
        ? group
        : undefined,
  }
}

/** The API query for a URL's filters. */
export function reportQuery(search: ReportSearch): ReportQuery {
  const month = currentMonth()
  const year = Number(today().slice(0, 4))
  const accountIds = search.accounts
  const back = (months: number) => ({
    from: `${addMonths(month, -(months - 1))}-01`,
    accountIds,
  })
  switch (search.range ?? "12m") {
    case "3m":
      return back(3)
    case "6m":
      return back(6)
    case "this-year":
      return { from: `${year}-01-01`, accountIds }
    case "last-year":
      return {
        from: `${year - 1}-01-01`,
        to: lastDay(`${year - 1}-12`),
        accountIds,
      }
    case "all":
      return { all: true, accountIds }
    case "custom":
      return { from: search.from, to: search.to, accountIds }
    default:
      return back(12)
  }
}
