import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
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
  dotRing,
  gridProps,
  key,
  monthTicks,
  moneyTick,
  seriesColor,
  xTickFormatter,
  yAxisProps,
} from "./common"

type Row = Record<string, unknown>

/**
 * Money over time: one series as a 2px line with a flat 10% fill (net worth,
 * an account's balance, IBKR value), or several as plain lines for a
 * comparison (this month against last). A crosshair follows the pointer;
 * hover shows every series' value. Rows with a null value end that line, so
 * "this month" can stop at today.
 */
export function AreaTrend<T extends Row>({
  data,
  x,
  series,
  currency,
  height = 240,
  xFormat = "month",
  baseline = "zero",
  fill = series.length === 1,
  endLabel = false,
  tooltipLabel,
  tooltipExtra,
  onPointClick,
  className,
}: {
  data: T[]
  /** The row field on the x axis: an ISO date, a month, or a number. */
  x: keyof T & string
  series: Series<keyof T & string>[]
  /** Values are minor units in this currency. */
  currency: string
  /** Pixels, axis band included. */
  height?: number
  xFormat?: XFormat
  /** "zero" starts the y axis at 0; "auto" fits it to the data (an investment's value). */
  baseline?: "zero" | "auto"
  /** The flat 10% fill under the first series; on by default for one series. */
  fill?: boolean
  /** An 8px dot and the value at the first series' last point. */
  endLabel?: boolean
  /** The tooltip's heading for an x value; defaults to "November 2026" / "12 Nov". */
  tooltipLabel?: (value: string | number) => string
  /** More tooltip lines for a row, e.g. assets and liabilities. */
  tooltipExtra?: (row: T) => TooltipRow[]
  onPointClick?: (row: T) => void
  className?: string
}) {
  const first = series[0].key
  let lastIndex = data.length - 1
  while (lastIndex >= 0 && typeof data[lastIndex][first] !== "number")
    lastIndex--
  const ticks =
    xFormat === "month"
      ? monthTicks(data.map((row) => row[x] as string))
      : undefined

  const xKey: string = x
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <LegendRow series={series} />
      <ChartContainer
        config={chartConfig(series)}
        className={cn("aspect-auto w-full", onPointClick && "cursor-pointer")}
        style={{ height }}
      >
        <AreaChart
          accessibilityLayer
          data={data}
          margin={{
            top: endLabel ? 24 : 8,
            right: endLabel ? 12 : 4,
            bottom: 0,
            left: 0,
          }}
          onClick={
            onPointClick
              ? (state) => {
                  const row = data[Number(state.activeIndex)]
                  if (row !== undefined) onPointClick(row)
                }
              : undefined
          }
        >
          <CartesianGrid {...gridProps} />
          <XAxis
            dataKey={xKey}
            {...axisProps}
            ticks={ticks}
            interval={ticks ? 0 : "preserveStartEnd"}
            minTickGap={ticks ? 0 : 24}
            height={xFormat === "month" ? 40 : 30}
            tick={xFormat === "month" ? <MonthTick /> : undefined}
            tickFormatter={
              xFormat === "month" ? undefined : xTickFormatter(xFormat)
            }
          />
          <YAxis
            {...yAxisProps}
            domain={
              baseline === "zero"
                ? [(min: number) => Math.min(0, min), "auto"]
                : ["auto", "auto"]
            }
            tickFormatter={moneyTick(currency)}
          />
          <ChartTooltip
            cursor={{
              stroke: "var(--muted-foreground)",
              strokeOpacity: 0.4,
              strokeWidth: 1,
            }}
            content={({ active, payload, label }) => (
              <TooltipPanel
                active={active}
                payload={payload}
                label={label}
                series={series}
                currency={currency}
                formatLabel={
                  tooltipLabel ?? ((v) => defaultTooltipLabel(xFormat, v))
                }
                extra={tooltipExtra as ((row: Row) => TooltipRow[]) | undefined}
              />
            )}
          />
          {series
            .map((s, i) => (
              <Area
                key={s.key}
                dataKey={key(s)}
                type="monotone"
                stroke={seriesColor(series, i)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={seriesColor(series, i)}
                fillOpacity={i === 0 && fill ? 0.1 : 0}
                baseValue={baseline === "auto" ? "dataMin" : undefined}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={{ ...dotRing, fill: seriesColor(series, i) }}
                dot={
                  i === 0 && endLabel
                    ? (props: { cx?: number; cy?: number; index?: number }) =>
                        props.index === lastIndex &&
                        props.cx !== undefined &&
                        props.cy !== undefined ? (
                          <g key="end">
                            <circle
                              cx={props.cx}
                              cy={props.cy}
                              {...dotRing}
                              fill={seriesColor(series, 0)}
                            />
                            <text
                              x={props.cx}
                              y={props.cy - 12}
                              textAnchor={props.cx > 80 ? "end" : "start"}
                              className="fill-foreground text-xs font-medium tabular-nums"
                            >
                              {formatMoney(
                                data[lastIndex][first] as number,
                                currency
                              )}
                            </text>
                          </g>
                        ) : (
                          <g key={props.index} />
                        )
                    : false
                }
              />
            ))
            // The first series draws last, on top of the comparison lines.
            .reverse()}
        </AreaChart>
      </ChartContainer>
    </div>
  )
}
