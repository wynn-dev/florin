import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { formatMoney, formatPercent } from "@/lib/format"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CHART_SLOTS } from "./common"

/** One part of a whole, e.g. an asset class's value. */
export type Segment = { key: string; label: string; value: number }

// The share printed inside each block: white where it reads, near-black on
// the lighter slots (and on most slots in dark mode, where they're lighter).
const INK = [
  "text-white dark:text-neutral-950",
  "text-neutral-950",
  "text-neutral-950",
  "text-neutral-950",
  "text-neutral-950",
  "text-white",
  "text-white dark:text-neutral-950",
  "text-neutral-950",
]

/**
 * One whole split into parts, as a tall (28px) bar of blocks: allocation by
 * asset class. Each part takes the next chart slot in order, so pass parts in
 * a fixed order (not by size) to keep their colours stable. Each block prints
 * its share where it fits; hover or focus gives name, amount and share; the
 * legend under it names the parts. Parts at zero draw nothing. At most 8.
 */
export function SegmentedBar({
  parts,
  currency,
  label,
  className,
}: {
  parts: Segment[]
  /** Values are minor units in this currency. */
  currency: string
  /** The bar's accessible name, e.g. "Allocation". */
  label: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width)
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0)
  const shown = parts
    .map((part, slot) => ({
      ...part,
      slot,
      share: total ? part.value / total : 0,
    }))
    .filter((part) => part.value > 0)
  const gaps = Math.max(0, shown.length - 1) * 2

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        ref={ref}
        role="img"
        aria-label={`${label}: ${shown
          .map((p) => `${p.label} ${formatPercent(p.share)}`)
          .join(", ")}`}
        className="flex h-7 w-full gap-0.5"
      >
        {shown.map((part) => {
          const text = formatPercent(part.share)
          const trueWidth = (width - gaps) * part.share
          const fits = trueWidth >= text.length * 7 + 14
          // A sliver too thin to see gets 2px, but only when the bar is wide
          // enough that adding it barely moves the others.
          const floor = trueWidth < 2 && width >= shown.length * 100
          return (
            <Tooltip key={part.key}>
              <TooltipTrigger asChild>
                <div
                  tabIndex={0}
                  aria-label={`${part.label}: ${formatMoney(part.value, currency)}, ${text}`}
                  className={cn(
                    "flex h-full min-w-0 items-center overflow-hidden rounded-[4px] text-xs font-medium tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    fits && "px-2",
                    INK[part.slot]
                  )}
                  style={{
                    flexGrow: part.share,
                    flexBasis: 0,
                    minWidth: floor ? 2 : 0,
                    background: CHART_SLOTS[part.slot],
                  }}
                >
                  {fits && text}
                </div>
              </TooltipTrigger>
              <TooltipContent className="tabular-nums">
                {part.label} · {formatMoney(part.value, currency)} · {text}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {shown.map((part) => (
          <span key={part.key} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: CHART_SLOTS[part.slot] }}
            />
            {part.label}
          </span>
        ))}
      </div>
    </div>
  )
}
