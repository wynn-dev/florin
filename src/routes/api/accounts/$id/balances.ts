import { createFileRoute } from "@tanstack/react-router"
import { listAccountBalances } from "@/server/data"
import { id, optionalInt, query, respond } from "@/server/http"

/** The balance a week apart over the last ?months (default 12), ending today. */
export const Route = createFileRoute("/api/accounts/$id/balances")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        respond(() =>
          listAccountBalances(id(params.id), optionalInt(query(request).months))
        ),
    },
  },
})
