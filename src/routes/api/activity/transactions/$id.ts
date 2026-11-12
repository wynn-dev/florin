import { createFileRoute } from "@tanstack/react-router"
import { transactionHistory } from "@/server/data"
import { id, respond } from "@/server/http"

/** A transaction's history, oldest first: who added it and each change since. */
export const Route = createFileRoute("/api/activity/transactions/$id")({
  server: {
    handlers: {
      GET: ({ params }) => respond(() => transactionHistory(id(params.id))),
    },
  },
})
