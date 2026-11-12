// What every florin chart shares: series colours, the axis formats and the
// tooltip panel. The marks themselves live in AreaTrend, Bars and
// SegmentedBar; pages pass data and never style a chart themselves.
import type { ReactNode } from "react"
import type { ChartConfig } from "@/components/ui/chart"
import {
  formatDate,
  formatMoney,
  formatMonth,
  formatMonthShort,
  formatMonthTick,
} from "@/lib/format"

/** One plotted value per row. `key` must be a plain identifier (it becomes a CSS variable). */
export type Series<TKey extends string = string> = {
  key: TKey
  label: string
  /**
   * A colour, e.g. "var(--chart-muted)". Defaults: one series is
   * var(--chart-ink); several take var(--chart-1), var(--chart-2)… in order.
   */
  color?: string
}

/** A line in the tooltip after the series values, e.g. assets and liabilities. */
export type TooltipRow = { label: string; value: ReactNode }

/** The palette's slots in order, never cycled. */
export const CHART_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8].map(
  (n) => `var(--chart-${n})`
)

export function seriesColor(series: Series[], index: number): string {
  return (
    series[index].color ??
    (series.length === 1 ? "var(--chart-ink)" : CHART_SLOTS[index])
  )
}

export function chartConfig(series: Series[]): ChartConfig {
  return Object.fromEntries(
    series.map((s, i) => [
      s.key,
      { label: s.label, color: seriesColor(series, i) },
    ])
  )
}

/**
 * How x values read. "month" takes months ("2026-03") or dates and ticks once
 * per month ("Nov", "Jan 2026"); "date" ticks dates ("12 Nov"); or a function.
 */
export type XFormat = "month" | "date" | ((value: string | number) => string)

export function xTickFormatter(
  format: XFormat
): (value: string | number) => string {
  if (typeof format === "function") return format
  return format === "month"
    ? (value) => formatMonthTick(String(value))
    : (value) => formatDate(String(value))
}

/**
 * Ticks for "month": the first row of each month (rows may be days or weeks;
 * a month whose first row is past the 7th has none),
 * thinned to every other month past seven, counting back from the latest so
 * it always has a tick. Undefined when the values aren't ISO dates or months.
 */
export function monthTicks(
  values: (string | number)[]
): (string | number)[] | undefined {
  if (!values.every((v) => typeof v === "string" && /^\d{4}-\d{2}/.test(v)))
    return undefined
  const seen = new Set<string>()
  const firsts = values.filter((v) => {
    const month = String(v).slice(0, 7)
    if (seen.has(month)) return false
    seen.add(month)
    // A month the data starts partway through gets no tick of its own.
    return String(v).length === 7 || Number(String(v).slice(8, 10)) <= 7
  })
  const step = firsts.length > 7 ? 2 : 1
  return firsts.filter((_, i) => (firsts.length - 1 - i) % step === 0)
}

/**
 * A month tick: "Nov", and at January the year on a second line, so the
 * axis keeps one short label per tick. Recharts passes the position props.
 */
export function MonthTick({
  x,
  y,
  payload,
}: {
  x?: number | string
  y?: number | string
  payload?: { value: string | number }
}) {
  if (!payload) return null
  const value = String(payload.value)
  const january = value.slice(5, 7) === "01"
  return (
    <text
      x={Number(x)}
      y={Number(y)}
      dy={4}
      textAnchor="middle"
      className="fill-muted-foreground text-xs"
    >
      <tspan x={Number(x)} dy="0.71em">
        {formatMonthShort(value)}
      </tspan>
      {january && (
        <tspan x={Number(x)} dy="1.2em">
          {value.slice(0, 4)}
        </tspan>
      )}
    </text>
  )
}

export function defaultTooltipLabel(
  format: XFormat,
  value: string | number
): string {
  if (typeof format === "function") return format(value)
  const text = String(value)
  return text.length === 7 ? formatMonth(text) : formatDate(text)
}

export function moneyTick(currency: string) {
  return (value: number) => formatMoney(value, currency, { compact: true })
}

export const axisProps = {
  axisLine: false,
  tickLine: false,
  tickMargin: 8,
  fontSize: 12,
} as const

/** The shared Y axis: compact money, tabular, no line. */
export const yAxisProps = {
  ...axisProps,
  width: "auto",
  tickCount: 5,
  className: "tabular-nums",
} as const

export const gridProps = {
  vertical: false,
  stroke: "var(--border)",
  strokeDasharray: undefined,
} as const

/** The 2px ring in the surface colour that dots and end markers wear. */
export const dotRing = {
  stroke: "var(--background)",
  strokeWidth: 2,
  r: 4,
} as const

type TooltipItem = {
  dataKey?: unknown
  value?: unknown
  color?: string
  payload?: Record<string, unknown>
}

/**
 * The tooltip every chart uses: the label on top, then each series with a
 * line indicator in its colour, its name muted and its value bold, then any
 * extra rows. Styled as shadcn's ChartTooltipContent with indicator="line",
 * with values formatted as money.
 */
export function TooltipPanel({
  active,
  payload,
  label,
  series,
  currency,
  formatLabel,
  extra,
}: {
  active?: boolean
  payload?: readonly TooltipItem[]
  label?: string | number
  series: Series[]
  currency: string
  formatLabel: (value: string | number) => string
  extra?: (row: Record<string, unknown>) => TooltipRow[]
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload ?? {}
  // In series order, whatever order the marks were drawn in.
  const items = series.flatMap(
    (s) =>
      payload.find(
        (item) => item.dataKey === s.key && typeof item.value === "number"
      ) ?? []
  )
  const rows = extra?.(row) ?? []
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs shadow-xl">
      {label !== undefined && (
        <div className="font-medium">{formatLabel(label)}</div>
      )}
      <div className="grid gap-1.5">
        {items.map((item) => {
          const index = series.findIndex((s) => s.key === item.dataKey)
          if (index < 0) return null
          return (
            <div key={series[index].key} className="flex items-stretch gap-2">
              <div
                className="w-1 shrink-0 rounded-[2px]"
                style={{ background: item.color ?? seriesColor(series, index) }}
              />
              <div className="flex flex-1 items-center justify-between gap-4 py-0.5 leading-none">
                <span className="text-muted-foreground">
                  {series[index].label}
                </span>
                <span className="font-medium text-foreground tabular-nums">
                  {formatMoney(item.value as number, currency)}
                </span>
              </div>
            </div>
          )
        })}
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between gap-4 pl-3 leading-none"
          >
            <span className="text-muted-foreground">{r.label}</span>
            <span className="font-medium text-foreground tabular-nums">
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The legend, for two or more series: a short line key and the name, in series order. */
export function LegendRow({ series }: { series: Series[] }) {
  if (series.length < 2) return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={{ background: seriesColor(series, i) }}
          />
          {s.label}
        </span>
      ))}
    </div>
  )
}

/** A series' key as Recharts takes it. */
export function key(series: Series): string {
  return series.key
}
