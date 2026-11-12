import { createFileRoute } from "@tanstack/react-router"
import { mapAccounts, psuHeaders } from "@/server/enablebanking"
import { body, id, respond } from "@/server/http"
import type { AccountMapping } from "@/shared/enablebanking"

/** Body: { accounts: [{ bankAccountId, accountId: <id> | "new" | null }] } → the first sync's result. */
export const Route = createFileRoute(
  "/api/connections/enable-banking/links/$id/accounts"
)({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        respond(async () => {
          const input = await body<{ accounts: AccountMapping[] }>(request)
          return mapAccounts(
            "person",
            id(params.id),
            input.accounts,
            psuHeaders(request)
          )
        }),
    },
  },
})
