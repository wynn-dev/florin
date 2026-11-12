import { useQuery } from "@tanstack/react-query"
import { Link, createFileRoute, notFound } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { CashFlowReport } from "@/components/reports/cash-flow-report"
import { ReportFilters } from "@/components/reports/filters"
import { IncomeExpensesReport } from "@/components/reports/income-expenses-report"
import { NetWorthReport } from "@/components/reports/net-worth-report"
import {
  REPORTS,
  reportQuery,
  validateReportSearch,
} from "@/components/reports/search"
import { SpendingReport } from "@/components/reports/spending-report"
import { Page } from "@/components/page"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ReportId, ReportSearch } from "@/components/reports/search"
import { queries } from "@/lib/api"

export const Route = createFileRoute("/_app/reports/$report")({
  validateSearch: validateReportSearch,
  beforeLoad: ({ params }) => {
    if (!REPORTS.some((r) => r.id === params.report)) throw notFound()
  },
  component: Reports,
})

/**
 * Four reports behind underline tabs (a scrolling toggle row on phones),
 * one filter row they share, kept in the URL so a view can be linked.
 */
function Reports() {
  const report = Route.useParams().report as ReportId
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const currency = useQuery(queries.settings()).data?.currency
  const accounts = useQuery(queries.accounts()).data
  // The budget reports cover on-budget accounts only: an off-budget pick
  // (made on Net worth) would filter them to nothing behind a picker that
  // can't show it, so it is dropped from the URL.
  const covered = (id: ReportId, ids: number[] | undefined) => {
    const kept = ids?.filter(
      (a) =>
        id === "net-worth" ||
        accounts?.find((account) => account.id === a)?.onBudget
    )
    return kept?.length ? kept : undefined
  }
  const accountIds = covered(report, search.accounts)
  const query = reportQuery({ ...search, accounts: accountIds })
  useEffect(() => {
    if (accounts && accountIds?.length !== search.accounts?.length)
      void navigate({
        search: (prev) => ({ ...prev, accounts: accountIds }),
        replace: true,
      })
  })
  const update = (next: Partial<ReportSearch>) =>
    void navigate({
      search: (prev) => validateReportSearch({ ...prev, ...next }),
      replace: true,
    })
  // The drill-down belongs to Spending; other tabs keep the range and the
  // accounts they cover.
  const tabSearch = (id: ReportId) => (prev: ReportSearch) => ({
    ...prev,
    accounts: covered(id, prev.accounts),
    group: undefined,
  })
  // On a phone the tabs scroll sideways; keep the open one in view.
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    strip.current
      ?.querySelector("[data-state=on]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [report])

  return (
    <Page title="Reports">
      <Tabs value={report} className="hidden md:flex">
        <TabsList variant="line" className="gap-4">
          {REPORTS.map((r) => (
            <TabsTrigger key={r.id} value={r.id} asChild className="px-0">
              <Link
                to="/reports/$report"
                params={{ report: r.id }}
                search={tabSearch(r.id)}
              >
                {r.label}
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div ref={strip} className="-mx-4 overflow-x-auto px-4 md:hidden">
        <ToggleGroup
          type="single"
          value={report}
          variant="outline"
          size="sm"
          className="w-max"
        >
          {REPORTS.map((r) => (
            <ToggleGroupItem key={r.id} value={r.id} asChild>
              <Link
                to="/reports/$report"
                params={{ report: r.id }}
                search={tabSearch(r.id)}
              >
                {r.label}
              </Link>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <ReportFilters
        search={{ ...search, accounts: accountIds }}
        onChange={update}
        onBudgetOnly={report !== "net-worth"}
      />
      {currency &&
        accounts &&
        (report === "net-worth" ? (
          <NetWorthReport query={query} currency={currency} />
        ) : report === "spending" ? (
          <SpendingReport
            query={query}
            currency={currency}
            group={search.group}
            onGroup={(group) =>
              void navigate({ search: (prev) => ({ ...prev, group }) })
            }
          />
        ) : report === "income-expenses" ? (
          <IncomeExpensesReport query={query} currency={currency} />
        ) : (
          <CashFlowReport query={query} currency={currency} />
        ))}
    </Page>
  )
}
