// MCP access tokens: the person creates one per client in settings; the client
// sends it as "Authorization: Bearer <token>" and its writes are recorded as
// "mcp:<token name>". Only a SHA-256 hash is stored.
import { createHash, randomBytes } from "node:crypto"
import { asc, eq, sql } from "drizzle-orm"
import { db, schema } from "../db"
import { logChange } from "./changes"
import { checkName, found, InvalidInput } from "./validate"
import type { Actor } from "@/shared/types"
import type { CreatedMcpToken, McpToken } from "@/shared/mcp"

const { mcpTokens } = schema

const columns = {
  id: mcpTokens.id,
  name: mcpTokens.name,
  createdAt: mcpTokens.createdAt,
  lastUsedAt: mcpTokens.lastUsedAt,
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function listMcpTokens(): McpToken[] {
  return db()
    .select(columns)
    .from(mcpTokens)
    .orderBy(asc(sql`lower(${mcpTokens.name})`))
    .all()
}

/** Creates a token; the answer is the only place its value ever appears. */
export function createMcpToken(actor: Actor, name: string): CreatedMcpToken {
  const clean = checkName(name)
  if (clean.length > 60)
    throw new InvalidInput("name must be at most 60 characters")
  const clash = db()
    .select({ id: mcpTokens.id })
    .from(mcpTokens)
    .where(sql`lower(${mcpTokens.name}) = lower(${clean})`)
    .get()
  if (clash) throw new InvalidInput(`a token named ${clean} already exists`)
  const token = `florin_${randomBytes(32).toString("base64url")}`
  const id = db().transaction((tx) => {
    const row = tx
      .insert(mcpTokens)
      .values({ name: clean, tokenHash: hashToken(token) })
      .returning({ id: mcpTokens.id })
      .get()
    logChange(tx, actor, {
      action: "create",
      entity: "mcp token",
      entityId: row.id,
      summary: `Created MCP token ${clean}`,
    })
    return row.id
  })
  return { id, name: clean, token }
}

/** Revokes a token: clients using it get 401 from then on. */
export function deleteMcpToken(actor: Actor, id: number): void {
  const token = found(
    db().select(columns).from(mcpTokens).where(eq(mcpTokens.id, id)).get(),
    "token"
  )
  db().transaction((tx) => {
    tx.delete(mcpTokens).where(eq(mcpTokens.id, id)).run()
    logChange(tx, actor, {
      action: "delete",
      entity: "mcp token",
      entityId: id,
      summary: `Revoked MCP token ${token.name}`,
    })
  })
}

/** The token's record when `token` is a current token (noting its use), else null. */
export function useMcpToken(token: string): McpToken | null {
  if (!token.startsWith("florin_")) return null
  const row = db()
    .select(columns)
    .from(mcpTokens)
    .where(eq(mcpTokens.tokenHash, hashToken(token)))
    .get()
  if (!row) return null
  const now = new Date().toISOString()
  // A busy client calls many times a minute; once a minute is precise enough.
  if (!row.lastUsedAt || Date.parse(now) - Date.parse(row.lastUsedAt) > 60_000)
    db()
      .update(mcpTokens)
      .set({ lastUsedAt: now })
      .where(eq(mcpTokens.id, row.id))
      .run()
  return { ...row, lastUsedAt: now }
}
