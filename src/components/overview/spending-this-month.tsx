import { useQuery } from "@tanstack/react-query"
import { live } from "./live"
import { AreaTrend } from "@/components/charts"
import { QueryState, SkeletonChart } from "@/components/states"
import { Card, CardContent } from "@/components/ui/card"
import { useIsMobile } from "@/hooks/use-mobile"
import { queries } from "@/lib/api"
import { formatMonth, lastDay } from "@/lib/format"

type Row = { day: number; current: number | null; previous: number | null }

/** Cumulative spending by day: this month up to today against all of last month. */
export function SpendingThisMonth({ currency }: { currency: string }) {
  const query = useQuery({ ...queries.spendingByDay(), ...live })
  const height = useIsMobile() ? 200 : 268
  return (
    <Card className="h-full gap-0 py-5 shadow-none">
      <CardContent className="flex flex-col gap-3 px-5">
        <h2 className="text-sm font-medium">Spending this month</h2>
        <QueryState query={query} skeleton={<SkeletonChart height={height} />}>
          {({ current, previous }) => {
            const days = Math.max(
              Number(lastDay(current.month).slice(8)),
              previous.days.length
            )
            const data: Row[] = Array.from({ length: days }, (_, i) => ({
              day: i + 1,
              current: current.days[i] ?? null,
              previous: previous.days[i] ?? null,
            }))
            return (
              <AreaTrend
                data={data}
                x="day"
                xFormat={(day) => String(day)}
                xTicks={[1, 8, 15, 22, 29]}
                series={[
                  {
                    key: "current",
                    label: monthName(current.month),
                    color: "var(--chart-ink)",
                  },
                  {
                    key: "previous",
                    label: monthName(previous.month),
                    color: "var(--chart-muted)",
                  },
                ]}
                currency={currency}
                height={height}
                endLabel
                // A running total moves in steps, one per day; a smooth curve
                // would invent wiggles between them.
                curve="stepAfter"
                tooltipLabel={(day) => `Day ${day}`}
                className="-mx-1"
              />
            )
          }}
        </QueryState>
      </CardContent>
    </Card>
  )
}

/** "November" from "2026-11". */
function monthName(month: string): string {
  return formatMonth(month).replace(/\s*\d{4}$/, "")
}
