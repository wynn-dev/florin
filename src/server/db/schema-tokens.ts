// MCP access tokens. Only a SHA-256 hash of each token is kept; the token
// itself is shown once, when it is created.
import { sql } from "drizzle-orm"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const mcpTokens = sqliteTable("mcp_tokens", {
  id: integer().primaryKey(),
  /** Unique; writes made with the token are recorded as "mcp:<name>". */
  name: text().notNull().unique(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  lastUsedAt: text("last_used_at"),
})
