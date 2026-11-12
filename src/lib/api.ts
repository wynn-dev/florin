// The web app's data layer: typed fetches against /api and the TanStack Query
// options built on them. Types come from src/shared/types.ts, the same ones
// the server returns.
import { queryOptions } from "@tanstack/react-query"
import type {
  Account,
  BudgetMonth,
  CashFlowPoint,
  CategoryGroup,
  CategorySpending,
  DateRange,
  IncomeExpensePoint,
  NetWorthPoint,
  Page,
  Payee,
  Settings,
  TransactionFilter,
  TransactionPage,
} from "@/shared/types"

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export async function api<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: init?.method ?? "GET",
    headers:
      init?.body === undefined
        ? undefined
        : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (response.status === 401 && path !== "/session") {
    window.location.href = "/login"
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new ApiError(error?.error ?? response.statusText, response.status)
  }
  return (response.status === 204 ? undefined : await response.json()) as T
}

function search(params: object): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== "" && v !== false
  )
  return entries.length
    ? "?" +
        new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()
    : ""
}

export const queries = {
  settings: () =>
    queryOptions({
      queryKey: ["settings"],
      queryFn: () => api<Settings>("/settings"),
    }),
  accounts: () =>
    queryOptions({
      queryKey: ["accounts"],
      queryFn: () => api<Account[]>("/accounts"),
    }),
  transactions: (filter: TransactionFilter = {}) =>
    queryOptions({
      queryKey: ["transactions", filter],
      queryFn: () => api<TransactionPage>(`/transactions${search(filter)}`),
    }),
  categories: () =>
    queryOptions({
      queryKey: ["categories"],
      queryFn: () => api<CategoryGroup[]>("/categories"),
    }),
  payees: (
    options: { search?: string; limit?: number; offset?: number } = {}
  ) =>
    queryOptions({
      queryKey: ["payees", options],
      queryFn: () => api<Page<Payee>>(`/payees${search(options)}`),
    }),
  budget: (month: string) =>
    queryOptions({
      queryKey: ["budget", month],
      queryFn: () => api<BudgetMonth>(`/budget/${month}`),
    }),
  netWorth: (range: Partial<DateRange> = {}) =>
    queryOptions({
      queryKey: ["reports", "net-worth", range],
      queryFn: () => api<NetWorthPoint[]>(`/reports/net-worth${search(range)}`),
    }),
  spending: (range: Partial<DateRange> = {}) =>
    queryOptions({
      queryKey: ["reports", "spending", range],
      queryFn: () =>
        api<CategorySpending[]>(`/reports/spending${search(range)}`),
    }),
  incomeExpenses: (range: Partial<DateRange> = {}) =>
    queryOptions({
      queryKey: ["reports", "income-expenses", range],
      queryFn: () =>
        api<IncomeExpensePoint[]>(`/reports/income-expenses${search(range)}`),
    }),
  cashFlow: (range: Partial<DateRange> = {}) =>
    queryOptions({
      queryKey: ["reports", "cash-flow", range],
      queryFn: () => api<CashFlowPoint[]>(`/reports/cash-flow${search(range)}`),
    }),
}
