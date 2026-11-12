import { and, eq, ne } from "drizzle-orm"
import { db, schema } from "../db"
import { logChange } from "./changes"
import { checkCurrency } from "./fx"
import { InvalidInput } from "./validate"
import type { Actor, Settings } from "@/shared/types"

const DEFAULTS: Settings = { currency: "EUR" }

export function getSettings(): Settings {
  const rows = db().select().from(schema.settings).all()
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return { ...DEFAULTS, ...stored }
}

export function updateSettings(
  actor: Actor,
  patch: Partial<Settings>
): Settings {
  if (patch.currency !== undefined) {
    checkCurrency(patch.currency)
    const { accounts } = schema
    const mismatch = db()
      .select({ name: accounts.name })
      .from(accounts)
      .where(
        and(eq(accounts.onBudget, true), ne(accounts.currency, patch.currency))
      )
      .get()
    if (mismatch) {
      throw new InvalidInput(
        `${mismatch.name} is on budget in another currency; take it off budget first`
      )
    }
    const currency = patch.currency
    db().transaction((tx) => {
      tx.insert(schema.settings)
        .values({ key: "currency", value: currency })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: { value: currency },
        })
        .run()
      logChange(tx, actor, {
        action: "update",
        entity: "settings",
        summary: `Set the budget currency to ${currency}`,
      })
    })
  }
  return getSettings()
}
