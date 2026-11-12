import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
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
import { formatMoney, formatMonth, formatMonthTick } from "@/lib/format"

export const Route = createFileRoute("/_app/")({ component: Overview })

const chartConfig = {
  netWorth: { label: "Net worth", color: "var(--foreground)" },
} satisfies ChartConfig

function Overview() {
  const currency = useQuery(queries.settings()).data?.currency ?? "EUR"
  const netWorth = useQuery(queries.netWorth())
  const accounts = useQuery(queries.accounts())
  const month = new Date().toISOString().slice(0, 7)
  const budget = useQuery(queries.budget(month))
  const latest = netWorth.data?.at(-1)
  const yearAgo = netWorth.data?.[0]

  return (
    <Page title="Overview">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Net worth"
          value={latest && formatMoney(latest.netWorth, currency)}
        >
          {latest && yearAgo && (
            <Change
              from={yearAgo.netWorth}
              to={latest.netWorth}
              currency={currency}
            />
          )}
        </Stat>
        <Stat
          label={`To budget in ${formatMonthTick(month)}`}
          value={budget.data && formatMoney(budget.data.toBudget, currency)}
        />
        <Stat
          label={`Spent in ${formatMonthTick(month)}`}
          value={budget.data && formatMoney(-budget.data.activity, currency)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Net worth</CardTitle>
          <CardDescription>
            End of each month, last twelve months
          </CardDescription>
        </CardHeader>
        <CardContent>
          {netWorth.data ? (
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-64 w-full"
            >
              <AreaChart data={netWorth.data} margin={{ left: 4, right: 4 }}>
                <defs>
                  <linearGradient id="fillNetWorth" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--color-netWorth)"
                      stopOpacity={0.12}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--color-netWorth)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(m: string) => formatMonthTick(m)}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(v: number) =>
                    formatMoney(v, currency, { compact: true })
                  }
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) =>
                        formatMonth(String(payload[0]?.payload.month))
                      }
                      formatter={(value) => (
                        <span className="font-medium tabular-nums">
                          {formatMoney(Number(value), currency)}
                        </span>
                      )}
                    />
                  }
                />
                <Area
                  dataKey="netWorth"
                  type="monotone"
                  stroke="var(--color-netWorth)"
                  strokeWidth={2}
                  fill="url(#fillNetWorth)"
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col">
          {accounts.data?.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between border-b py-2.5 text-sm last:border-0"
            >
              <div className="flex flex-col">
                <span className="font-medium">{a.name}</span>
                <span className="text-xs text-muted-foreground capitalize">
                  {a.type}
                  {!a.onBudget && " · tracking"}
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className="tabular-nums">
                  {formatMoney(a.balance, a.currency)}
                </span>
                {a.currency !== currency && a.budgetBalance !== null && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    ≈ {formatMoney(a.budgetBalance, currency)}
                  </span>
                )}
              </div>
            </div>
          )) ?? <Skeleton className="h-40 w-full" />}
        </CardContent>
      </Card>
    </Page>
  )
}

function Stat({
  label,
  value,
  children,
}: {
  label: string
  value?: string
  children?: React.ReactNode
}) {
  return (
    <Card className="gap-1 py-5">
      <CardHeader className="px-5">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {value ? (
          <div className="text-2xl font-semibold tracking-tight tabular-nums">
            {value}
          </div>
        ) : (
          <Skeleton className="h-8 w-32" />
        )}
        {children}
      </CardContent>
    </Card>
  )
}

function Change({
  from,
  to,
  currency,
}: {
  from: number
  to: number
  currency: string
}) {
  const diff = to - from
  return (
    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
      {diff >= 0 ? "+" : "−"}
      {formatMoney(Math.abs(diff), currency)} over twelve months
    </p>
  )
}
