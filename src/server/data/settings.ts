import { and, eq, ne } from "drizzle-orm"
import { db, schema } from "../db"
import { listenPort, loadConfig } from "../config"
import { runJobSoon } from "../jobs"
import { logChange } from "./changes"
import { checkCurrency } from "./fx"
import { InvalidInput } from "./validate"
import type { Actor, Settings } from "@/shared/types"

const DEFAULTS: Settings = { currency: "EUR", publicUrl: "" }

export function getSettings(): Settings {
  const rows = db().select().from(schema.settings).all()
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return { ...DEFAULTS, ...stored }
}

/**
 * The address florin is reached at, without a trailing slash: the publicUrl
 * setting, else http://localhost:<port>. The Enable Banking redirect and the
 * MCP endpoint shown in the dashboard are built on it.
 */
export function publicUrl(): string {
  return (
    getSettings().publicUrl || `http://localhost:${listenPort(loadConfig())}`
  )
}

/** "" or an http(s) address with no query or fragment, without a trailing slash. */
function checkPublicUrl(value: unknown): string {
  if (typeof value !== "string")
    throw new InvalidInput("publicUrl must be a string")
  const text = value.trim()
  if (!text) return ""
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new InvalidInput(
      "publicUrl must be an address like https://florin.example.com"
    )
  }
  if (!["http:", "https:"].includes(url.protocol) || url.search || url.hash) {
    throw new InvalidInput(
      "publicUrl must be an address like https://florin.example.com"
    )
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "")
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
    if (patch.currency !== getSettings().currency) {
      save(
        actor,
        "currency",
        patch.currency,
        `Set the budget currency to ${patch.currency}`
      )
      runJobSoon("ecb")
    }
  }
  if (patch.publicUrl !== undefined) {
    const url = checkPublicUrl(patch.publicUrl)
    save(
      actor,
      "publicUrl",
      url,
      url ? `Set the public address to ${url}` : "Cleared the public address"
    )
  }
  return getSettings()
}

function save(
  actor: Actor,
  key: keyof Settings,
  value: string,
  summary: string
) {
  db().transaction((tx) => {
    tx.insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run()
    logChange(tx, actor, { action: "update", entity: "settings", summary })
  })
}
