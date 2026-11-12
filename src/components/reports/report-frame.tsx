import type { ReactNode } from "react"
import type { ReportBase } from "@/shared/reports"
import {
  EmptyState,
  QueryState,
  SkeletonChart,
  SkeletonRows,
} from "@/components/states"
import { useIsMobile } from "@/hooks/use-mobile"
import { addDays, today } from "@/lib/format"
import { cn } from "@/lib/utils"

/** The chart's height, axis band included: 360px, or 240px on a phone. */
export function useChartHeight(): number {
  return useIsMobile() ? 240 : 360
}

/**
 * What every report shares: a skeleton chart and five rows on first load,
 * an inline error with Retry, the empty state before a month of data, and
 * while a filter change refetches, the previous report at half opacity.
 */
export function ReportFrame<T extends ReportBase>({
  query,
  children,
}: {
  query: {
    data: T | undefined
    isError: boolean
    isFetching: boolean
    isPlaceholderData: boolean
    refetch: () => unknown
  }
  children: (report: T) => ReactNode
}) {
  const height = useChartHeight()
  return (
    <QueryState
      query={query}
      error="Couldn't load this report."
      skeleton={
        <div className="flex flex-col gap-6">
          <SkeletonChart height={height} />
          <SkeletonRows rows={5} />
        </div>
      }
    >
      {(report) =>
        !report.dataFrom || report.dataFrom > addDays(today(), -28) ? (
          <EmptyState
            title="Reports fill in once you have a month of transactions"
            className="py-24"
          />
        ) : (
          <div
            aria-busy={query.isPlaceholderData}
            className={cn(
              "flex flex-col gap-6 transition-opacity",
              query.isPlaceholderData && "opacity-50"
            )}
          >
            {children(report)}
          </div>
        )
      }
    </QueryState>
  )
}

/** The report's key figure and one muted line of context. */
export function Headline({
  label,
  value,
  detail,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight">{value}</span>
      {detail && (
        <span className="text-sm text-muted-foreground">{detail}</span>
      )}
    </div>
  )
}
