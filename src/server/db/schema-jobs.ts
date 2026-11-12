// The background jobs' state (src/server/jobs.ts), kept so it survives restarts.
// Times are ISO timestamps, UTC.
import { sqliteTable, text } from "drizzle-orm/sqlite-core"

export const jobs = sqliteTable("jobs", {
  name: text().primaryKey(),
  lastStartedAt: text("last_started_at"),
  lastSuccessAt: text("last_success_at"),
  /** The last run's error message; null once a run succeeds. */
  lastError: text("last_error"),
  nextDueAt: text("next_due_at"),
})
