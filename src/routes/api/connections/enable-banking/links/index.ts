import { createFileRoute } from "@tanstack/react-router"
import { listBankLinks, startLink } from "@/server/enablebanking"
import { body, respond } from "@/server/http"
import type { StartLink } from "@/shared/enablebanking"

/**
 * GET → every bank link with its state, without asking Enable Banking (for
 * account pages and lists). POST, body { country, bank, returnTo? } → { url }:
 * send the browser there to authorise at the bank.
 */
export const Route = createFileRoute("/api/connections/enable-banking/links/")({
  server: {
    handlers: {
      GET: () => respond(() => listBankLinks()),
      POST: ({ request }) =>
        respond(async () => startLink(await body<StartLink>(request))),
    },
  },
})
