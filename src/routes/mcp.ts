import { createFileRoute } from "@tanstack/react-router"
import { handleMcpRequest } from "@/server/mcp/http"

// The MCP over streamable HTTP; it checks its own access token (src/start.ts
// lets /mcp through without a dashboard session).
export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => handleMcpRequest(request),
      POST: ({ request }) => handleMcpRequest(request),
      DELETE: ({ request }) => handleMcpRequest(request),
    },
  },
})
