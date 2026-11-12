// The web app's data layer: typed fetches against /api and the TanStack Query
// options built on them. Types come from src/shared/types.ts, the same ones
// the server returns.
import { queryOptions } from "@tanstack/react-query"
import type { Attention } from "@/shared/attention"
import type {
  CashFlowReport,
  IncomeExpenseReport,
  NetWorthReport,
  ReportQuery,
  SpendingByDay,
  SpendingReport,
} from "@/shared/reports"
import type {
  Account,
  BudgetMonth,
  CategoryGroup,
  Page,
  Payee,
  Settings,
  TransactionFilter,
  TransactionPage,
} from "@/shared/types"
import type { FxStatus, Job } from "@/shared/jobs"
import type { McpTokenList } from "@/shared/mcp"
import type { SetupStatus } from "@/shared/setup"

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
  netWorth: (query: ReportQuery & { step?: NetWorthReport["step"] } = {}) =>
    queryOptions({
      queryKey: ["reports", "net-worth", query],
      queryFn: () =>
        api<NetWorthReport>(`/reports/net-worth${reportSearch(query)}`),
    }),
  spending: (query: ReportQuery = {}) =>
    queryOptions({
      queryKey: ["reports", "spending", query],
      queryFn: () =>
        api<SpendingReport>(`/reports/spending${reportSearch(query)}`),
    }),
  incomeExpenses: (query: ReportQuery = {}) =>
    queryOptions({
      queryKey: ["reports", "income-expenses", query],
      queryFn: () =>
        api<IncomeExpenseReport>(
          `/reports/income-expenses${reportSearch(query)}`
        ),
    }),
  cashFlow: (query: ReportQuery = {}) =>
    queryOptions({
      queryKey: ["reports", "cash-flow", query],
      queryFn: () =>
        api<CashFlowReport>(`/reports/cash-flow${reportSearch(query)}`),
    }),
  spendingByDay: (month?: string) =>
    queryOptions({
      queryKey: ["reports", "spending-by-day", month],
      queryFn: () =>
        api<SpendingByDay>(`/reports/spending-by-day${search({ month })}`),
    }),
  attention: () =>
    queryOptions({
      queryKey: ["attention"],
      queryFn: () => api<Attention>("/attention"),
    }),
  jobs: () =>
    queryOptions({
      queryKey: ["jobs"],
      queryFn: () => api<Job[]>("/jobs"),
    }),
  fxStatus: () =>
    queryOptions({
      queryKey: ["fx-status"],
      queryFn: () => api<FxStatus>("/fx/status"),
    }),
  mcpTokens: () =>
    queryOptions({
      queryKey: ["mcp-tokens"],
      queryFn: () => api<McpTokenList>("/mcp-tokens"),
    }),
  setup: () =>
    queryOptions({
      queryKey: ["setup"],
      queryFn: () => api<SetupStatus>("/setup"),
    }),
}

function reportSearch({
  accountIds,
  ...rest
}: ReportQuery & { step?: string }) {
  return search({ ...rest, accounts: accountIds?.join(",") })
}
