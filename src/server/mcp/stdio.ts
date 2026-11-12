// `florin mcp`: the MCP over stdio for a client on the same machine. It opens
// florin's database directly, so it works whether or not the service runs;
// writes are recorded as "mcp:<the client's name>".
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { db } from "../db"
import { createMcpServer } from "./server"
import type { Readable, Writable } from "node:stream"
import type { Actor } from "@/shared/types"

/** Serves until stdin closes; tests pass their own streams. */
export async function serveStdio(
  input: Readable = process.stdin,
  output: Writable = process.stdout
): Promise<void> {
  db() // create or migrate the database before the client's first call
  const server = createMcpServer((): Actor => {
    const name = server.server.getClientVersion()?.name?.trim()
    return `mcp:${name ? name.slice(0, 60) : "stdio"}`
  })
  await server.connect(new StdioServerTransport(input, output))
}
