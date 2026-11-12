import { createFileRoute } from "@tanstack/react-router"
import { psuHeaders, syncAll } from "@/server/enablebanking"
import { respond } from "@/server/http"
import "@/server/job-list"

/** Syncs every bank link now, as the person (so the bank's background limit doesn't apply). */
export const Route = createFileRoute("/api/connections/enable-banking/sync")({
  server: {
    handlers: {
      POST: ({ request }) =>
        respond(() => syncAll({ psu: psuHeaders(request) })),
    },
  },
})
