// `florin token <name>`: creates an MCP access token without the dashboard,
// for an agent working on the machine. It is the same kind of token Settings ›
// Connections › MCP makes (listed and revoked there), logged in Activity the
// same way. The token alone goes to stdout, so `florin token X > file` works;
// the hint goes to stderr. It writes the database directly, so it works
// whether or not the service is running.
import { closeDatabase } from "../server/db"
import { createMcpToken, publicUrl } from "../server/data"

type Output = { write: (text: string) => unknown }

export function token(
  args: string[],
  out: Output = process.stdout,
  err: Output = process.stderr
): void {
  const name = args.join(" ").trim()
  if (!name) throw new Error("give the token a name: florin token <name>")
  try {
    const created = createMcpToken("person", name)
    out.write(`${created.token}\n`)
    err.write(
      `Created MCP token ${created.name}. Send it as "Authorization: Bearer <token>" to ${publicUrl()}/mcp; it is not shown again. Revoke it in Settings › Connections › MCP.\n`
    )
  } finally {
    closeDatabase()
  }
}
