// MCP access tokens, as /api/mcp-tokens serves them to the dashboard's settings.

/** A token as listed: its secret is never shown again after creation. */
export type McpToken = {
  id: number
  name: string
  /** ISO timestamps, UTC. */
  createdAt: string
  lastUsedAt: string | null
}

/** GET /api/mcp-tokens */
export type McpTokenList = { items: McpToken[] }

/** POST /api/mcp-tokens body. */
export type NewMcpToken = { name: string }

/** POST /api/mcp-tokens answer: `token` is shown this once and stored only as a hash. */
export type CreatedMcpToken = { id: number; name: string; token: string }
