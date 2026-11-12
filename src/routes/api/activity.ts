import { createFileRoute } from "@tanstack/react-router"
import { listActivity } from "@/server/data"
import { optionalInt, query, respond } from "@/server/http"

/** Recent changes, newest first. ?actor=person|bank-sync|import|mcp:<name> ("mcp:" for every MCP client), limit, offset. */
export const Route = createFileRoute("/api/activity")({
  server: {
    handlers: {
      GET: ({ request }) =>
        respond(() => {
          const q = query(request)
          return listActivity({
            actor: q.actor,
            limit: optionalInt(q.limit),
            offset: optionalInt(q.offset),
          })
        }),
    },
  },
})
