const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}:${compact}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
    })
    formatters.set(key, f)
  }
  return f
}

/** Formats integer minor units (cents) as money. */
export function formatMoney(
  amount: number,
  currency: string,
  options: { compact?: boolean } = {}
): string {
  const f = formatter(currency, Boolean(options.compact))
  const digits =
    formatter(currency, false).resolvedOptions().maximumFractionDigits ?? 2
  return f.format(amount / 10 ** digits)
}

/** "2026-03" → "Mar 2026" (or "Mar" when short). */
export function formatMonth(month: string, short = false): string {
  const [y, m] = month.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: "short",
    year: short ? undefined : "numeric",
    timeZone: "UTC",
  })
}

export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}
