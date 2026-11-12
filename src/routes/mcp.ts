import { createFileRoute } from "@tanstack/react-router"

// Placeholder: the MCP server (streamable HTTP) lands here, over the same data
// layer as /api (src/server/data).
const notYet = () =>
  Response.json(
    { error: "the MCP server is not implemented yet" },
    { status: 501 }
  )

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: { GET: notYet, POST: notYet, DELETE: notYet },
  },
})
