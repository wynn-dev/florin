import { createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-sqlite"
import { migrateSync } from "drizzle-orm/sqlite-core/async/session"
import { databasePath } from "../config"
import * as schema from "./schema"
import type { MigrationMeta } from "drizzle-orm/migrator"

// Migrations are generated into drizzle/ by `pnpm db:generate` and bundled
// into the build, so the shipped app needs no migrations folder on disk.
const migrationFiles = import.meta.glob<string>(
  "../../../drizzle/*/migration.sql",
  {
    query: "?raw",
    import: "default",
    eager: true,
  }
)

function migrations(): MigrationMeta[] {
  return Object.entries(migrationFiles)
    .map(([path, query]) => {
      const name = path.split("/").at(-2)!
      const d = name.slice(0, 14)
      return {
        name,
        sql: query.split("--> statement-breakpoint"),
        bps: true,
        hash: createHash("sha256").update(query).digest("hex"),
        folderMillis: Date.UTC(
          +d.slice(0, 4),
          +d.slice(4, 6) - 1,
          +d.slice(6, 8),
          +d.slice(8, 10),
          +d.slice(10, 12),
          +d.slice(12, 14)
        ),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function openDatabase(path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const database = drizzle({ connection: { path } })
  // WAL and a busy timeout let another florin process (e.g. `florin
  // seed-demo`) write while the service runs. Write transactions start
  // immediate, so one that waits for the other process waits out the busy
  // timeout instead of failing on a stale read.
  database.$client.exec(
    "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;"
  )
  // A transaction started inside another (a data-layer call inside a larger
  // all-or-nothing step, like mapping a bank's accounts) becomes a savepoint
  // of the outer one instead of failing.
  const transaction = database.transaction.bind(database)
  let open: Parameters<Parameters<typeof transaction>[0]>[0] | undefined
  database.transaction = (fn, config) => {
    const outer = open
    const run: typeof fn = (tx) => {
      open = tx
      try {
        return fn(tx)
      } finally {
        open = outer
      }
    }
    return outer
      ? outer.transaction(run)
      : transaction(run, { behavior: "immediate", ...config })
  }
  migrateSync(
    migrations(),
    (database as unknown as { session: Parameters<typeof migrateSync>[1] })
      .session,
    {}
  )
  addDefaultCategories(database)
  return database
}

/** The category opening balances are booked to, found by this key whatever its name. */
export const STARTING_BALANCES = "starting-balances"
const DEFAULTS_ADDED = "defaultCategoriesAdded"

const DEFAULT_CATEGORIES: [string, boolean, string[]][] = [
  ["Income", true, ["Income", "Starting balances"]],
  ["Bills", false, ["Rent", "Utilities", "Phone & internet", "Insurance"]],
  ["Everyday", false, ["Groceries", "Dining out", "Transport", "Shopping"]],
  ["Goals", false, ["Emergency fund", "Holidays"]],
]

/**
 * A new budget starts with a small set of categories the person can change,
 * once: a budget whose categories were all deleted stays without them.
 */
function addDefaultCategories(database: ReturnType<typeof drizzle>) {
  const added = database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, DEFAULTS_ADDED))
    .get()
  if (added) return
  database.transaction((tx) => {
    tx.insert(schema.settings).values({ key: DEFAULTS_ADDED, value: "1" }).run()
    if (tx.select().from(schema.categoryGroups).limit(1).all().length) return
    DEFAULT_CATEGORIES.forEach(([name, isIncome, cats], i) => {
      const group = tx
        .insert(schema.categoryGroups)
        .values({ name, isIncome, sortOrder: i + 1 })
        .returning({ id: schema.categoryGroups.id })
        .get()
      tx.insert(schema.categories)
        .values(
          cats.map((c, j) => ({
            groupId: group.id,
            name: c,
            sortOrder: j + 1,
            key: c === "Starting balances" ? STARTING_BALANCES : null,
          }))
        )
        .run()
    })
  })
}

export type Database = ReturnType<typeof openDatabase>

let current: Database | undefined

/** The open database, opened (and migrated) on first use. */
export function db(): Database {
  current ??= openDatabase(databasePath())
  return current
}

export function closeDatabase(): void {
  current?.$client.close()
  current = undefined
}

export { schema }
