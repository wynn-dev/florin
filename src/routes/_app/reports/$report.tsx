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
  const query = reportQuery(search)
  const update = (next: Partial<ReportSearch>) =>
    void navigate({
      search: (prev) => validateReportSearch({ ...prev, ...next }),
      replace: true,
    })
  // The drill-down belongs to Spending; other tabs keep the range and accounts.
  const tabSearch = (prev: ReportSearch) => ({ ...prev, group: undefined })
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
                search={tabSearch}
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
                search={tabSearch}
              >
                {r.label}
              </Link>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <ReportFilters
        search={search}
        onChange={update}
        onBudgetOnly={report !== "net-worth"}
      />
      {currency &&
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
