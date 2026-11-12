import { createFileRoute } from "@tanstack/react-router"
import { psuHeaders, syncLink } from "@/server/enablebanking"
import { id, respond } from "@/server/http"
import "@/server/job-list"

/** Syncs one bank link now, as the person (so the bank's background limit doesn't apply). */
export const Route = createFileRoute(
  "/api/connections/enable-banking/links/$id/sync"
)({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        respond(() => syncLink(id(params.id), { psu: psuHeaders(request) })),
    },
  },
})
