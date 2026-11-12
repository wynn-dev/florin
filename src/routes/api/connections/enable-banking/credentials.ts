import { createFileRoute } from "@tanstack/react-router"
import { enableBankingStatus, setCredentials } from "@/server/enablebanking"
import { body, respond } from "@/server/http"
import type { SetCredentials } from "@/shared/enablebanking"

/** Body: { appId?, privateKey? }. Checked with Enable Banking before saving; a 400 says what is wrong. */
export const Route = createFileRoute(
  "/api/connections/enable-banking/credentials"
)({
  server: {
    handlers: {
      PUT: ({ request }) =>
        respond(async () => {
          await setCredentials(await body<SetCredentials>(request))
          return enableBankingStatus()
        }),
    },
  },
})
