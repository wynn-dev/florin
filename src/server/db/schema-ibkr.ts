// The IBKR connector's state (src/server/ibkr/): one row. The Flex token is a
// secret and lives in config.json (src/server/secrets.ts), not here. Nothing
// from the report's Account Information section is stored besides each
// account's id and base currency, which are on the accounts themselves
// (provider "ibkr", externalId, currency). Times are ISO timestamps, UTC.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const ibkr = sqliteTable("ibkr", {
  id: integer().primaryKey(),
  queryId: text("query_id"),
  /** When IBKR generated the newest report florin stored. */
  lastReportAt: text("last_report_at"),
  /** The end date (toDate) of the newest report, for the next pull's overlap. */
  lastReportTo: text("last_report_to"),
  /** When the last pull started; pulls are spaced at least a minute apart. */
  lastPullStartedAt: text("last_pull_started_at"),
  lastPullAt: text("last_pull_at"),
  /** The last pull's error in plain words; null after a success. */
  lastError: text("last_error"),
  /**
   * Set when the last error needs the person (an expired token, a wrong query
   * id): the daily pull stops until the token or query id changes.
   */
  needsPerson: integer("needs_person", { mode: "boolean" })
    .notNull()
    .default(false),
  /** No pull before this time (IBKR throttled or blocked the token). */
  blockedUntil: text("blocked_until"),
  /** JSON list of the Flex sections the last report lacked. */
  missingSections: text("missing_sections").notNull().default("[]"),
})
