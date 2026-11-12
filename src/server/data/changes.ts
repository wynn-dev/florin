// The change log: every write in the data layer records who made it and a
// short readable summary, inside the write's own database transaction.
import { desc, eq, sql } from "drizzle-orm"
import { db, schema } from "../db"
import { minorDigits } from "./fx"
import { InvalidInput } from "./validate"
import type { Database } from "../db"
import type { Actor, Change, Page } from "@/shared/types"

const { changes } = schema

export function checkActor(actor: unknown): Actor {
  if (
    actor === "person" ||
    actor === "bank-sync" ||
    actor === "ibkr" ||
    actor === "import" ||
    actor === "demo" ||
    (typeof actor === "string" && /^mcp:.{1,80}$/.test(actor))
  ) {
    return actor as Actor
  }
  throw new InvalidInput(
    "actor must be person, bank-sync, ibkr, import, demo or mcp:<client>"
  )
}

export function logChange(
  tx: Pick<Database, "insert">,
  actor: Actor,
  change: Pick<Change, "action" | "entity" | "summary"> & {
    entityId?: number | null
  }
): void {
  tx.insert(changes)
    .values({
      actor: checkActor(actor),
      ...change,
      entityId: change.entityId ?? null,
    })
    .run()
}

/** Recent changes, newest first; optionally only one actor's ("mcp:" matches every MCP client). */
export function listActivity(
  options: { actor?: string; limit?: number; offset?: number } = {}
): Page<Change> {
  const where = options.actor
    ? options.actor.endsWith(":")
      ? sql`${changes.actor} like ${options.actor + "%"}`
      : eq(changes.actor, options.actor)
    : undefined
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500)
  const items = db()
    .select()
    .from(changes)
    .where(where)
    .orderBy(desc(changes.id))
    .limit(limit)
    .offset(Math.max(options.offset ?? 0, 0))
    .all() as Change[]
  const total = db()
    .select({ n: sql<number>`count(*)` })
    .from(changes)
    .where(where)
    .get()!.n
  return { items, total }
}

/** Money for summaries: "−€42.50". */
export function money(amount: number, currency: string): string {
  const digits = minorDigits(currency)
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    signDisplay: "auto",
  })
    .format(amount / 10 ** digits)
    .replace("-", "−")
}

/** "name → Joint, closed → true" for change summaries. */
export function describe(set: Record<string, unknown>): string {
  return Object.entries(set)
    .map(([k, v]) => `${k} → ${v}`)
    .join(", ")
}
