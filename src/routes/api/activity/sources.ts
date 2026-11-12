import { createFileRoute } from "@tanstack/react-router"
import { listActivitySources } from "@/server/data"
import { respond } from "@/server/http"

/** Every source that has made a change, the most recent first. */
export const Route = createFileRoute("/api/activity/sources")({
  server: {
    handlers: {
      GET: () => respond(() => listActivitySources()),
    },
  },
})
