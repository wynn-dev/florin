import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { accountQueries } from "./queries"
import { ConnectionLine } from "./connection"
import { AccountRegister } from "./slots"
import type { Account, AccountValue, AssetClass, Holding } from "@/shared/types"
import { cn } from "@/lib/utils"
import { queries } from "@/lib/api"
import {
  addDays,
  currencyDigits,
  formatDate,
  formatMoney,
  formatPercent,
  formatQuantity,
  today,
} from "@/lib/format"
import { AreaTrend, SegmentedBar } from "@/components/charts"
import { usePullIbkr } from "@/components/connections/ibkr/use-ibkr"
import { Money } from "@/components/money"
import {
  EmptyState,
  QueryState,
  SkeletonChart,
  SkeletonRows,
} from "@/components/states"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const RANGES = ["1M", "3M", "YTD", "1Y", "All"] as const
type Range = (typeof RANGES)[number]

/** The first date a range covers, counting back from today. */
function rangeStart(range: Range, now = today()): string {
  if (range === "All") return "0000-01-01"
  if (range === "YTD") return `${now.slice(0, 4)}-01-01`
  const months = { "1M": 1, "3M": 3, "1Y": 12 }[range]
  const d = new Date(`${now}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - months)
  return addDays(d.toISOString().slice(0, 10), 0)
}

/** The allocation bar's asset classes, in their fixed colour order. */
const CLASSES: [AssetClass, string][] = [
  ["stock", "Stocks"],
  ["etf", "ETFs"],
  ["bond", "Bonds"],
  ["cash", "Cash"],
  ["other", "Other"],
]

/** A price or cash amount in major units (12.5) as minor units for formatMoney. */
function minor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** currencyDigits(currency))
}

export function InvestmentAccount({ account }: { account: Account }) {
  const values = useQuery(accountQueries.values(account.id))
  const holdings = useQuery(accountQueries.holdings(account.id))
  const currency = useQuery(queries.settings()).data?.currency
  const [range, setRange] = useState<Range>("1Y")

  if (values.data?.length === 0 && account.provider === "ibkr")
    return <WaitingForReport />

  const all = values.data ?? []
  const start = rangeStart(range)
  const shown = all.filter((v) => v.date >= start)
  const first = shown.at(0)
  const last = all.at(-1)
  const change = first && last ? last.value - first.value : 0
  const changeShare = first?.value ? change / first.value : 0
  const daily = range === "1M" || range === "3M"
  const foreign = currency && account.currency !== currency

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-4xl font-semibold tracking-tight">
            {formatMoney(account.balance, account.currency)}
          </span>
          {foreign && account.budgetBalance !== null && (
            <span className="text-lg text-muted-foreground">
              ≈ {formatMoney(account.budgetBalance, currency, { whole: true })}
            </span>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          {first && (
            <>
              <Money
                cents={change}
                currency={account.currency}
                signed
                className={change < 0 ? "text-foreground" : undefined}
              />
              <span className="tabular-nums">
                ({formatPercent(changeShare, { signed: true, digits: 1 })})
              </span>
              <span>{rangeLabel(range)}</span>
              <span aria-hidden>·</span>
            </>
          )}
          {last && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>as of {formatDate(last.date)}</span>
              </TooltipTrigger>
              <TooltipContent>
                Values are end of day, as of the last report
              </TooltipContent>
            </Tooltip>
          )}
          {account.provider !== "ibkr" && (
            <>
              <span aria-hidden>·</span>
              <ConnectionLine account={account} className="inline" />
            </>
          )}
        </p>
        {account.provider === "ibkr" && <ConnectionLine account={account} />}
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">Value</h2>
          <ToggleGroup
            type="single"
            size="sm"
            spacing={0}
            value={range}
            onValueChange={(next) => next && setRange(next as Range)}
            aria-label="Range"
            className="rounded-md bg-muted p-0.5"
          >
            {RANGES.map((r) => (
              <ToggleGroupItem
                key={r}
                value={r}
                className="h-6 rounded-[5px]! px-2.5 text-xs text-muted-foreground tabular-nums hover:bg-transparent data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs data-[state=on]:hover:bg-background"
              >
                {r}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <QueryState
          query={values}
          skeleton={<SkeletonChart height={240} />}
          error="Couldn't load the value history."
        >
          {() =>
            shown.length > 1 ? (
              <AreaTrend<AccountValue>
                data={shown}
                x="date"
                xFormat={daily ? "date" : "month"}
                baseline="auto"
                series={[{ key: "value", label: "Value" }]}
                currency={account.currency}
                height={240}
                tooltipLabel={(d) => formatDate(String(d))}
                tooltipExtra={(row) =>
                  first
                    ? [
                        {
                          label: "Change",
                          value: `${formatMoney(row.value - first.value, account.currency, { signed: true })} (${formatPercent(
                            first.value
                              ? (row.value - first.value) / first.value
                              : 0,
                            { signed: true, digits: 1 }
                          )})`,
                        },
                      ]
                    : []
                }
              />
            ) : (
              <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                Not enough values in this range yet
              </div>
            )
          }
        </QueryState>
      </section>

      <QueryState
        query={holdings}
        skeleton={<SkeletonRows rows={6} />}
        error="Couldn't load the holdings."
      >
        {(rows) => (
          <>
            {rows.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-medium">Allocation</h2>
                <SegmentedBar
                  label="Allocation"
                  currency={account.currency}
                  parts={CLASSES.map(([key, label]) => ({
                    key,
                    label,
                    value: rows
                      .filter((h) => h.assetClass === key)
                      .reduce((s, h) => s + h.value, 0),
                  }))}
                />
              </section>
            )}
            <Tabs defaultValue="holdings" className="gap-4">
              <TabsList variant="line">
                <TabsTrigger value="holdings">Holdings</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>
              <TabsContent value="holdings">
                <Holdings rows={rows} currency={account.currency} />
              </TabsContent>
              <TabsContent value="activity">
                <AccountRegister account={account} runningBalance={false} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </QueryState>
    </div>
  )
}

function rangeLabel(range: Range): string {
  return {
    "1M": "past month",
    "3M": "past 3 months",
    YTD: "this year",
    "1Y": "past year",
    All: "all time",
  }[range]
}

/** Before IBKR's first report has arrived. */
function WaitingForReport() {
  const pull = usePullIbkr()
  return (
    <EmptyState
      title="Waiting for the first IBKR report"
      description="Reports are end of day; this can take a minute."
    >
      <Button onClick={() => pull.mutate()} disabled={pull.isPending}>
        {pull.isPending && <Spinner />}
        Pull now
      </Button>
    </EmptyState>
  )
}

const HOLDING_COLUMNS =
  "grid items-center gap-x-4 px-2 grid-cols-[minmax(0,1fr)_7rem_4rem] md:grid-cols-[minmax(0,1fr)_6rem_6.5rem_7.5rem_4rem]"
const HOLDING_COLUMNS_PNL =
  "grid items-center gap-x-4 px-2 grid-cols-[minmax(0,1fr)_7rem_4rem] md:grid-cols-[minmax(0,1fr)_6rem_6.5rem_7.5rem_9.5rem_4rem]"

/**
 * Holdings sorted by value: Symbol + description · Quantity · Price (in the
 * instrument's currency) · Value · Unrealised P/L (when the report has cost
 * basis) · Weight. Cash closes the table under a separator.
 */
function Holdings({ rows, currency }: { rows: Holding[]; currency: string }) {
  if (rows.length === 0)
    return <EmptyState title="No holdings in the last report" />
  const total = rows.reduce((s, h) => s + h.value, 0)
  const positions = rows
    .filter((h) => h.assetClass !== "cash")
    .sort((a, b) => b.value - a.value)
  const cash = rows.filter((h) => h.assetClass === "cash")
  const pnl = rows.some((h) => h.unrealizedPnl != null)
  const columns = pnl ? HOLDING_COLUMNS_PNL : HOLDING_COLUMNS
  const desktop = "hidden md:block"

  const row = (h: Holding, isCash: boolean) => (
    <div
      key={h.symbol}
      role="row"
      className={cn(columns, "h-10 border-b text-sm hover:bg-muted/50")}
    >
      <span role="cell" className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-semibold">
          {isCash ? `${h.currency} cash` : h.symbol}
        </span>
        {!isCash && (
          <span className="truncate text-muted-foreground">{h.name}</span>
        )}
      </span>
      <span role="cell" className={cn(desktop, "text-right tabular-nums")}>
        {isCash
          ? formatMoney(minor(h.quantity, h.currency), h.currency)
          : formatQuantity(h.quantity)}
      </span>
      <span role="cell" className={cn(desktop, "text-right tabular-nums")}>
        {isCash ? "" : formatMoney(minor(h.price, h.currency), h.currency)}
      </span>
      <span role="cell" className="text-right tabular-nums">
        {formatMoney(h.value, currency, { symbol: false })}
      </span>
      {pnl && (
        <span role="cell" className={cn(desktop, "text-right tabular-nums")}>
          {h.unrealizedPnl == null ? (
            ""
          ) : (
            <>
              <Money
                cents={h.unrealizedPnl}
                currency={currency}
                symbol={false}
                signed
              />
              {h.costBasis ? (
                <span className="ml-1.5 text-muted-foreground">
                  {formatPercent(h.unrealizedPnl / h.costBasis, {
                    signed: true,
                    digits: 1,
                  })}
                </span>
              ) : null}
            </>
          )}
        </span>
      )}
      <span
        role="cell"
        className="text-right text-muted-foreground tabular-nums"
      >
        {formatPercent(total ? h.value / total : 0, { digits: 1 })}
      </span>
    </div>
  )

  return (
    <div role="table" aria-label="Holdings">
      <div
        role="row"
        className={cn(
          columns,
          "h-9 border-b text-xs font-medium text-muted-foreground"
        )}
      >
        <span role="columnheader">Symbol</span>
        <span role="columnheader" className={cn(desktop, "text-right")}>
          Quantity
        </span>
        <span role="columnheader" className={cn(desktop, "text-right")}>
          Price
        </span>
        <span role="columnheader" className="text-right">
          Value · {currency}
        </span>
        {pnl && (
          <span role="columnheader" className={cn(desktop, "text-right")}>
            Unrealised P/L
          </span>
        )}
        <span role="columnheader" className="text-right">
          Weight
        </span>
      </div>
      {positions.map((h) => row(h, false))}
      {cash.length > 0 && (
        <div className="border-t border-foreground/15">
          {cash.map((h) => row(h, true))}
        </div>
      )}
    </div>
  )
}
