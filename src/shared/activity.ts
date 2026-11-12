// Activity: the change log read as entries, one per data-layer call, sync run
// or import (a change batch), as /api/activity serves them.
import type { Actor } from "./types"

/** What an entry is about, for the Kind filter. */
export type ActivityKind =
  "transactions" | "budget" | "accounts" | "categories" | "settings"

export const ACTIVITY_KINDS: ActivityKind[] = [
  "transactions",
  "budget",
  "accounts",
  "categories",
  "settings",
]

export type ActivityEntry = {
  /** The batch id: the id of the entry's first change. */
  id: number
  /** When the entry's first change was made, ISO UTC. */
  at: string
  actor: Actor
  kind: ActivityKind
  /** What the source did, to follow its name: "categorised 23 transactions". */
  summary: string
  /** How many changes the entry holds. */
  count: number
  /**
   * How many transactions it added or changed that still exist; the entry's
   * rows as they are now come from the transactions list with `change`.
   */
  transactions: number
  /** The entry's other change lines (deletes, budget, categories…), first 10. */
  lines: string[]
  /** How many such lines there are in all. */
  lineCount: number
}

export type ActivityFilter = {
  /** An actor ("person", "mcp:Claude Desktop") or a prefix ending in ":" ("mcp:" for every MCP client). */
  source?: string
  kind?: ActivityKind
  /** ISO timestamps: changes at or after `from` and before `to`. */
  from?: string
  to?: string
  /** Only entries older than this entry id (the cursor for the next page). */
  before?: number
  limit?: number
}

/** A page of entries, newest first; `next` is the `before` for the next page, null at the end. */
export type ActivityPage = { items: ActivityEntry[]; next: number | null }

/** One line of a transaction's history, oldest first. */
export type HistoryLine = {
  id: number
  /** The entry it belongs to. */
  batch: number
  at: string
  actor: Actor
  /** "Added", "Category set to Groceries", "Memo edited". */
  text: string
}
