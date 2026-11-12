import { createFileRoute } from "@tanstack/react-router"
import { renewLink } from "@/server/enablebanking"
import { body, id, respond } from "@/server/http"

/** Body: { returnTo? } → { url }: send the browser there to renew access at the bank. */
export const Route = createFileRoute(
  "/api/connections/enable-banking/links/$id/renew"
)({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        respond(async () => {
          const input = await body<{ returnTo?: string }>(request).catch(
            () => ({ returnTo: undefined })
          )
          return renewLink(id(params.id), input.returnTo)
        }),
    },
  },
})
