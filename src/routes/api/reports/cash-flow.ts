import { createFileRoute } from "@tanstack/react-router"
import { cashFlow } from "@/server/data"
import { query, respond } from "@/server/http"

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD, by default the last twelve months. */
export const Route = createFileRoute("/api/reports/cash-flow")({
  server: {
    handlers: {
      GET: ({ request }) => respond(() => cashFlow(query(request))),
    },
  },
})
