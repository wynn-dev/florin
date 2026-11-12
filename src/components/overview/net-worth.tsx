import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { live } from "./live"
import { AreaTrend } from "@/components/charts"
import { Money } from "@/components/money"
import { QueryState, SkeletonChart, SkeletonFigure } from "@/components/states"
import { Card, CardContent } from "@/components/ui/card"
import { useIsMobile } from "@/hooks/use-mobile"
import { queries } from "@/lib/api"
import { formatDate, formatMoney } from "@/lib/format"

/** The page's hero: net worth, its change over the chart, and a year of it by week. */
export function NetWorth({ currency }: { currency: string }) {
  const query = useQuery({ ...queries.netWorth({ step: "week" }), ...live })
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const height = mobile ? 160 : 232

  return (
    <Card className="h-full gap-0 py-5 shadow-none">
      <CardContent className="flex flex-col gap-5 px-5">
        <QueryState
          query={query}
          skeleton={
            <>
              <SkeletonFigure />
              <SkeletonChart height={height} />
            </>
          }
        >
          {(report) => {
            const first = report.points[0]
            const last = report.points.at(-1)
            const change = last && first ? last.netWorth - first.netWorth : 0
            return (
              <>
                <div className="flex flex-col gap-1">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    Net worth
                  </h2>
                  <Money
                    cents={last?.netWorth ?? 0}
                    currency={currency}
                    tabular={false}
                    className="text-4xl font-semibold tracking-tight"
                  />
                  {first && (
                    <p className="text-sm text-muted-foreground">
                      {formatMoney(change, currency, { signed: true })} since{" "}
                      {formatDate(first.date)}
                      {report.leftOut.length > 0 &&
                        ` · leaves out ${report.leftOut.join(", ")} until its exchange rate arrives`}
                    </p>
                  )}
                </div>
                <AreaTrend
                  data={report.points}
                  x="date"
                  series={[{ key: "netWorth", label: "Net worth" }]}
                  currency={currency}
                  baseline="auto"
                  height={height}
                  className="-mx-1"
                  tooltipExtra={(row) => [
                    {
                      label: "Assets",
                      value: formatMoney(row.assets, currency),
                    },
                    {
                      label: "Liabilities",
                      value: formatMoney(row.liabilities, currency),
                    },
                  ]}
                  onPointClick={() =>
                    void navigate({
                      to: "/reports/$report",
                      params: { report: "net-worth" },
                    })
                  }
                />
              </>
            )
          }}
        </QueryState>
      </CardContent>
    </Card>
  )
}
