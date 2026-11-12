import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"
import type { Series, TooltipRow, XFormat } from "./common"
import { cn } from "@/lib/utils"
import { formatMoney } from "@/lib/format"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import {
  LegendRow,
  MonthTick,
  TooltipPanel,
  axisProps,
  chartConfig,
  defaultTooltipLabel,
  gridProps,
  key,
  moneyTick,
  seriesColor,
  xTickFormatter,
  yAxisProps,
} from "./common"

type Row = Record<string, unknown>

/**
 * Money by category or period, as bars no thicker than 24px with 4px rounded
 * ends:
 * - "columns": vertical bars; two or more series stand side by side (income
 *   and expenses per month), with a legend.
 * - "ranked": thin horizontal bars, largest first, names on the left and
 *   each amount at its bar's end instead of an axis (spending by group).
 *   Pass the rows already sorted.
 * - "diverging": one series of columns above and below zero, coloured by sign
 *   (positive var(--chart-1), negative var(--chart-2), or `divergingColors`).
 *
 * `highlight` picks rows to draw in the series colour while the rest go
 * var(--chart-muted), e.g. the current month among the last twelve.
 */
export function Bars<T extends Row>({
  data,
  category,
  series,
  currency,
  variant = "columns",
  height,
  categoryFormat,
  highlight,
  divergingColors = ["var(--chart-1)", "var(--chart-2)"],
  labelLast = false,
  tooltipLabel,
  tooltipExtra,
  onBarClick,
  className,
}: {
  data: T[]
  /** The row field naming each bar or group: a month, a date, a name. */
  category: keyof T & string
  series: Series<keyof T & string>[]
  /** Values are minor units in this currency. */
  currency: string
  variant?: "columns" | "ranked" | "diverging"
  /** Pixels, axis band included. For "ranked", leave it out to get 32px per bar. */
  height?: number
  /** How category values read; months ("2026-03") default to "Mar", dates to "12 Nov". */
  categoryFormat?: XFormat
  highlight?: (row: T) => boolean
  /** [positive, negative] for "diverging". */
  divergingColors?: [string, string]
  /** Writes each series' value on the last group's bars (the latest month). */
  labelLast?: boolean
  tooltipLabel?: (value: string | number) => string
  tooltipExtra?: (row: T) => TooltipRow[]
  onBarClick?: (row: T) => void
  className?: string
}) {
  const ranked = variant === "ranked"
  const format: XFormat =
    categoryFormat ??
    (typeof data[0]?.[category] === "string" &&
    /^\d{4}-\d{2}(-\d{2})?$/.test(data[0][category])
      ? (data[0][category] as string).length === 7
        ? "month"
        : "date"
      : (value) => String(value))
  const categoryTick = xTickFormatter(format)
  const plotHeight =
    height ?? (ranked ? Math.max(96, data.length * 32 + 8) : 240)

  const fillFor = (row: T, index: number): string => {
    if (variant === "diverging") {
      return (row[series[index].key] as number) < 0
        ? divergingColors[1]
        : divergingColors[0]
    }
    if (highlight && !highlight(row)) return "var(--chart-muted)"
    return seriesColor(series, index)
  }

  const categoryKey: string = category
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <LegendRow series={variant === "diverging" ? [] : series} />
      <ChartContainer
        config={chartConfig(series)}
        className={cn(
          "aspect-auto w-full",
          onBarClick && "[&_.recharts-bar-rectangle]:cursor-pointer"
        )}
        style={{ height: plotHeight }}
      >
        <BarChart
          accessibilityLayer
          data={data}
          layout={ranked ? "vertical" : "horizontal"}
          barGap={2}
          barCategoryGap={ranked ? 9 : "20%"}
          margin={{
            top: labelLast ? 20 : ranked ? 0 : 8,
            right: labelLast ? 16 : ranked ? 88 : 4,
            bottom: 0,
            left: 0,
          }}
        >
          {ranked ? (
            <>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey={categoryKey}
                {...axisProps}
                width="auto"
                interval={0}
                tickFormatter={categoryTick}
              />
            </>
          ) : (
            <>
              <CartesianGrid {...gridProps} />
              <XAxis
                dataKey={categoryKey}
                {...axisProps}
                minTickGap={8}
                height={format === "month" ? 40 : 30}
                tick={format === "month" ? <MonthTick /> : undefined}
                tickFormatter={format === "month" ? undefined : categoryTick}
              />
              <YAxis {...yAxisProps} tickFormatter={moneyTick(currency)} />
            </>
          )}
          {variant === "diverging" && (
            <ReferenceLine
              y={0}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.5}
            />
          )}
          <ChartTooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }}
            content={({ active, payload, label }) => (
              <TooltipPanel
                active={active}
                payload={payload}
                label={label}
                series={series}
                currency={currency}
                formatLabel={
                  tooltipLabel ?? ((v) => defaultTooltipLabel(format, v))
                }
                extra={tooltipExtra as ((row: Row) => TooltipRow[]) | undefined}
              />
            )}
          />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={key(s)}
              fill={seriesColor(series, i)}
              maxBarSize={ranked ? 14 : 24}
              radius={ranked ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              isAnimationActive={false}
              onClick={
                onBarClick
                  ? (entry: { payload?: T }) => {
                      if (entry.payload) onBarClick(entry.payload)
                    }
                  : undefined
              }
            >
              {data.map((row, index) => (
                <Cell key={index} fill={fillFor(row, i)} />
              ))}
              {ranked && (
                <LabelList
                  dataKey={key(s)}
                  position="right"
                  offset={8}
                  className="fill-foreground text-xs font-medium tabular-nums"
                  formatter={(value: unknown) =>
                    typeof value === "number"
                      ? formatMoney(value, currency, { whole: true })
                      : ""
                  }
                />
              )}
              {labelLast && (
                <LabelList
                  dataKey={key(s)}
                  content={(props) => {
                    const { index, x, y, width, value } = props
                    if (index !== data.length - 1 || typeof value !== "number")
                      return null
                    return (
                      <text
                        x={Number(x) + Number(width) / 2}
                        y={Number(y) - 6}
                        textAnchor="middle"
                        className="fill-foreground text-xs font-medium tabular-nums"
                      >
                        {formatMoney(value, currency, { compact: true })}
                      </text>
                    )
                  }}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
    </div>
  )
}
