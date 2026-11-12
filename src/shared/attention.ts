// API types for Overview's Needs attention list (/api/attention).

/**
 * What the item's one button does: open a page in the dashboard (`to` with
 * optional router search and hash), or POST to an /api path (`post`) and, if
 * the answer carries a `url`, send the browser there (a bank's consent page);
 * an answer with an `error` (a sync that failed again) shows it.
 */
export type AttentionAction =
  | {
      label: string
      to: string
      search?: Record<string, unknown>
      hash?: string
    }
  | { label: string; post: string; body?: Record<string, unknown> }

export type AttentionItem = {
  /** Stable across refetches, e.g. "overspent:12". */
  id: string
  /** "person": only the person can do it (shown at once, first). "agent": an agent normally handles it. */
  who: "person" | "agent"
  /** One line, a state with its age: "14 transactions uncategorised for over a day". */
  text: string
  /** When it started (ISO timestamp, UTC). */
  since: string
  action: AttentionAction
}

export type Attention = {
  /** At most five, the person's first, then the oldest first. */
  items: AttentionItem[]
  /**
   * How long agent items wait before they show: 24 hours, or 0 when no MCP
   * client has been seen in the last seven days.
   */
  graceHours: number
}
