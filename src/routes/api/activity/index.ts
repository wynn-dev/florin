import { createFileRoute } from "@tanstack/react-router"
import { listActivity, listActivityEntries } from "@/server/data"
import { optionalInt, query, respond } from "@/server/http"
import type { ActivityKind } from "@/shared/activity"

/**
 * Activity entries, newest first, one per call or sync run:
 * ?source=person|ibkr|mcp:<name>|bank-sync:<bank>|import:<file> (a prefix
 * ending in ":" matches all of a kind, "mcp:" every MCP client),
 * kind=transactions|budget|accounts|categories|settings, from, to (ISO
 * timestamps), entry (one entry by id), before (the previous page's next),
 * limit.
 * ?lines=1 answers the change lines instead, as before: actor, limit, offset.
 */
export const Route = createFileRoute("/api/activity/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        respond(() => {
          const q = query(request)
          if (q.lines === "1")
            return listActivity({
              actor: q.actor,
              limit: optionalInt(q.limit),
              offset: optionalInt(q.offset),
            })
          return listActivityEntries({
            source: q.source,
            kind: q.kind as ActivityKind | undefined,
            from: q.from,
            to: q.to,
            before: optionalInt(q.before),
            entry: optionalInt(q.entry),
            limit: optionalInt(q.limit),
          })
        }),
    },
  },
})
