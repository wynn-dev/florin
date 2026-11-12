import { useId } from "react"
import { cn } from "@/lib/utils"

/**
 * A small trend with no axes, for a list row: a 1.5px line over the same
 * fading fill as AreaTrend, scaled to its own range. Decorative: the row
 * states the figures, so it is hidden from screen readers.
 */
export function Sparkline({
  values,
  width = 112,
  height = 28,
  className,
}: {
  values: number[]
  width?: number
  height?: number
  className?: string
}) {
  const gradient = `spark-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`
  if (values.length < 2) return <span style={{ width, height }} />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 2
  const points = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ])
  const line = points
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join("")
  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0 overflow-visible", className)}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.2} />
          <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path
        d={`${line}L${width},${height}L0,${height}Z`}
        fill={`url(#${gradient})`}
      />
      <path
        d={line}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
