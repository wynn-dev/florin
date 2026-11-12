import { createFileRoute } from "@tanstack/react-router"
import { startLink } from "@/server/enablebanking"
import { body, respond } from "@/server/http"
import type { StartLink } from "@/shared/enablebanking"

/** Body: { country, bank, returnTo? } → { url }: send the browser there to authorise at the bank. */
export const Route = createFileRoute("/api/connections/enable-banking/links/")({
  server: {
    handlers: {
      POST: ({ request }) =>
        respond(async () => startLink(await body<StartLink>(request))),
    },
  },
})
