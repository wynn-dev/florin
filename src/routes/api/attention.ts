import { createFileRoute } from "@tanstack/react-router"
import { needsAttention } from "@/server/data"
import { respond } from "@/server/http"
import "@/server/job-list"

/** Overview's Needs attention: up to five items, the person's first. */
export const Route = createFileRoute("/api/attention")({
  server: {
    handlers: {
      GET: () => respond(() => needsAttention()),
    },
  },
})
