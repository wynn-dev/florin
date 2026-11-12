import { createFileRoute } from "@tanstack/react-router"
import { enableBankingStatus } from "@/server/enablebanking"
import { respond } from "@/server/http"
import "@/server/job-list"

/** Credentials (set or not, never their values), the redirect URL, the sync interval and every bank link. */
export const Route = createFileRoute("/api/connections/enable-banking/")({
  server: {
    handlers: {
      GET: () => respond(enableBankingStatus),
    },
  },
})
