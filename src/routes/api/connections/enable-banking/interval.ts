import { createFileRoute } from "@tanstack/react-router"
import { enableBankingStatus, setSyncHours } from "@/server/enablebanking"
import { body, respond } from "@/server/http"
import type { SyncHours } from "@/shared/enablebanking"

/** Body: { hours: 6 | 12 | 24 }. */
export const Route = createFileRoute(
  "/api/connections/enable-banking/interval"
)({
  server: {
    handlers: {
      PUT: ({ request }) =>
        respond(async () => {
          setSyncHours((await body<{ hours: SyncHours }>(request)).hours)
          return enableBankingStatus()
        }),
    },
  },
})
