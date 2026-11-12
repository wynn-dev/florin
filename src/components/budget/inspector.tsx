import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { AssignedCell, AvailablePillText, Figure, SpentLink } from "./cells"
import { CoverButton } from "./month-parts"
import { MoveMoney } from "./move-money"
import { budgetQueries } from "./queries"
import type { BudgetCategoryDetail } from "@/shared/budget"
import type { BudgetCategory, BudgetMonth } from "@/shared/types"
import {
  addMonths,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMonth,
} from "@/lib/format"
import { Bars } from "@/components/charts"
import { sourceName } from "@/components/source-label"
import { SkeletonChart } from "@/components/states"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * The month's totals, shown when no category is selected: money in, planned,
 * spent, and when not zero what was left from last month, what went over
 * last month (it came out of the money not planned yet) and what is over
 * plan now, with Cover what went over.
 */
export function MonthSummary({
  month,
  currency,
}: {
  month: BudgetMonth
  currency: string
}) {
  const carried = month.available - month.budgeted - month.activity
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{formatMonth(month.month)}</h2>
      <dl className="flex flex-col">
        <Figure label="Money in">{formatMoney(month.income, currency)}</Figure>
        <Figure label="Planned">{formatMoney(month.budgeted, currency)}</Figure>
        <Figure label="Spent">
          {formatMoney(0 - month.activity, currency)}
        </Figure>
        {carried !== 0 && (
          <Figure label="Left from last month">
            {formatMoney(carried, currency)}
          </Figure>
        )}
        {month.lastMonthOverspent > 0 && (
          <Figure label="Went over last month">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{formatMoney(month.lastMonthOverspent, currency)}</span>
              </TooltipTrigger>
              <TooltipContent>
                Came out of the money not planned yet
              </TooltipContent>
            </Tooltip>
          </Figure>
        )}
        {month.overspent > 0 && (
          <Figure label="Over plan">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-negative">
                  {formatMoney(month.overspent, currency)}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Cover it this month, or it comes out of the money not planned
                yet in {formatMonth(addMonths(month.month, 1))}
              </TooltipContent>
            </Tooltip>
          </Figure>
        )}
      </dl>
      {month.overspent > 0 && (
        <CoverButton month={month} currency={currency} className="self-start" />
      )}
    </section>
  )
}

/**
 * "Claude Desktop planned €400.00", "You moved CHF 40.00 to Groceries", from
 * a change's summary. Whether money came in or went out is the server's
 * answer (by category id), not a guess from names; the amount is whatever
 * comes before " for " or " from ", spaces and all. Reads the older wording
 * (Budgeted, Ready to assign) the same way.
 */
export function describeChange(
  change: NonNullable<BudgetCategoryDetail["lastChange"]>,
  month: string
): string {
  const inMonth = (m: string) => (m === month ? "" : ` in ${formatMonth(m)}`)
  const planned =
    /^(?:Planned|Budgeted) (.+?)( more| less)? for .+ in (\d{4}-\d{2})( to cover what went over)?$/.exec(
      change.summary
    )
  const moved = /^Moved (.+?) from (.+) to (.+) in (\d{4}-\d{2})$/.exec(
    change.summary
  )
  const unplanned = "Ready to assign"
  const what = planned
    ? planned[4]
      ? `covered ${planned[1]} over${inMonth(planned[3])}`
      : `planned ${planned[1]}${planned[2] ?? ""}${inMonth(planned[3])}`
    : moved && (moved[2] === unplanned || moved[3] === unplanned)
      ? `planned ${moved[1]} ${moved[2] === unplanned ? "more" : "less"}${inMonth(moved[4])}`
      : moved
        ? `moved ${moved[1]} ${change.into ? `from ${moved[2]}` : `to ${moved[3]}`}${inMonth(moved[4])}`
        : change.summary.charAt(0).toLowerCase() + change.summary.slice(1)
  return `${sourceName(change.actor)} ${what}`
}

export function LastChange({
  detail,
  month,
}: {
  detail: BudgetCategoryDetail | undefined
  month: string
}) {
  if (!detail) return <div className="h-5" />
  const change = detail.lastChange
  if (!change)
    return <p className="text-sm text-muted-foreground">No changes yet</p>
  return (
    <p className="text-sm text-muted-foreground">
      <Link
        to="/activity"
        search={{ entry: change.entry }}
        className="text-foreground underline-offset-4 hover:underline"
      >
        {describeChange(change, month)}
      </Link>
      {" · "}
      <Tooltip>
        <TooltipTrigger asChild>
          <time dateTime={change.at} className="tabular-nums">
            {formatDate(change.at.slice(0, 10))}
          </time>
        </TooltipTrigger>
        <TooltipContent>{formatDateTime(change.at)}</TooltipContent>
      </Tooltip>
    </p>
  )
}

/** Twelve months of spending, this month in ink; clicking a bar opens that month. */
export function SpendingHistory({
  detail,
  month,
  currency,
}: {
  detail: BudgetCategoryDetail | undefined
  month: string
  currency: string
}) {
  const navigate = useNavigate()
  if (!detail) return <SkeletonChart height={160} />
  return (
    <Bars
      data={detail.history}
      category="month"
      series={[{ key: "spent", label: "Spent" }]}
      currency={currency}
      height={160}
      highlight={(row) => row.month === month}
      tooltipLabel={(m) => formatMonth(String(m))}
      onBarClick={(row) =>
        void navigate({ to: "/budget/$month", params: { month: row.month } })
      }
    />
  )
}

/** A selected category: Planned, Spent and Left, Last change, 12 months of spending and Move money. */
export function CategoryInspector({
  month,
  category,
  currency,
}: {
  month: BudgetMonth
  category: BudgetCategory
  currency: string
}) {
  const detail = useQuery(budgetQueries.category(month.month, category.id))
  const [moving, setMoving] = useState(false)
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="truncate text-sm font-medium">{category.name}</h2>
        <LastChange detail={detail.data} month={month.month} />
      </div>
      <dl className="flex flex-col">
        <Figure label="Planned">
          <AssignedCell
            month={month.month}
            category={category}
            currency={currency}
            symbol
            className="-mr-2 w-28"
          />
        </Figure>
        <Figure label="Spent">
          <SpentLink
            month={month.month}
            category={category}
            currency={currency}
            symbol
          />
        </Figure>
        <Figure label="Left">
          <AvailablePillText
            available={category.available}
            currency={currency}
            className="-mr-2"
          />
        </Figure>
      </dl>
      <SpendingHistory
        detail={detail.data}
        month={month.month}
        currency={currency}
      />
      <Popover open={moving} onOpenChange={setMoving}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="self-start">
            Move money
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-80 gap-0 p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <MoveMoney
            month={month}
            category={category}
            currency={currency}
            onDone={() => setMoving(false)}
          />
        </PopoverContent>
      </Popover>
    </section>
  )
}
