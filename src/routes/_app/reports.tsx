import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Bar, BarChart, XAxis, YAxis } from "recharts"
import type { ChartConfig } from "@/components/ui/chart"
import { Page } from "@/components/page"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { queries } from "@/lib/api"
import { formatMoney } from "@/lib/format"

export const Route = createFileRoute("/_app/reports")({ component: Reports })

const chartConfig = {
  amount: { label: "Spent", color: "var(--foreground)" },
} satisfies ChartConfig

function Reports() {
  const currency = useQuery(queries.settings()).data?.currency ?? "EUR"
  const spending = useQuery(queries.spending())
  const top = spending.data?.slice(0, 10)
  return (
    <Page title="Reports">
      <Card>
        <CardHeader>
          <CardTitle>Spending by category</CardTitle>
          <CardDescription>Last twelve months, top ten</CardDescription>
        </CardHeader>
        <CardContent>
          {top ? (
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-80 w-full"
            >
              <BarChart
                data={top}
                layout="vertical"
                margin={{ left: 8, right: 8 }}
              >
                <YAxis
                  dataKey="categoryName"
                  type="category"
                  tickLine={false}
                  axisLine={false}
                  width={120}
                />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) =>
                    formatMoney(v, currency, { compact: true })
                  }
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      formatter={(value) => (
                        <span className="font-medium tabular-nums">
                          {formatMoney(Number(value), currency)}
                        </span>
                      )}
                    />
                  }
                />
                <Bar
                  dataKey="amount"
                  fill="var(--color-amount)"
                  radius={4}
                  barSize={14}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <Skeleton className="h-80 w-full" />
          )}
        </CardContent>
      </Card>
    </Page>
  )
}
