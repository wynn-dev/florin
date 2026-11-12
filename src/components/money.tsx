import { cn } from "@/lib/utils"
import { formatMoney } from "@/lib/format"

/**
 * An amount of money, the one way pages show one. Tabular figures by default
 * (pass `tabular={false}` for a hero). With `signed`, as on every transaction
 * amount, the sign always shows and inflows read in --positive; outflows stay
 * in the normal foreground, because spending isn't an error. Colour what's
 * wrong (over plan, planned more than you have) with `className="text-negative"`.
 */
export function Money({
  cents,
  currency,
  signed = false,
  symbol = true,
  compact = false,
  tabular = true,
  className,
}: {
  cents: number
  currency: string
  /** Always show + or −, and colour inflows. */
  signed?: boolean
  /** False for a column that's all one currency, named once in its header. */
  symbol?: boolean
  compact?: boolean
  tabular?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap",
        tabular && "tabular-nums",
        signed && cents > 0 && "text-positive",
        className
      )}
    >
      {formatMoney(cents, currency, { signed, symbol, compact })}
    </span>
  )
}
