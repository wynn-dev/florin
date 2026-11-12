import { createFileRoute } from "@tanstack/react-router"
import {
  deleteTransaction,
  getTransaction,
  updateTransaction,
} from "@/server/data"
import { body, id, respond } from "@/server/http"
import type { TransactionPatch } from "@/shared/types"

export const Route = createFileRoute("/api/transactions/$id")({
  server: {
    handlers: {
      GET: ({ params }) => respond(() => getTransaction(id(params.id))),
      PATCH: ({ request, params }) =>
        respond(async () =>
          updateTransaction(
            "person",
            id(params.id),
            await body<TransactionPatch>(request)
          )
        ),
      DELETE: ({ params }) =>
        respond(() => deleteTransaction("person", id(params.id))),
    },
  },
})
