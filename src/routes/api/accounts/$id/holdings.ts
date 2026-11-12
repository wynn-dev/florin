import { createFileRoute } from "@tanstack/react-router"
import { listHoldings } from "@/server/data"
import { id, respond } from "@/server/http"

export const Route = createFileRoute("/api/accounts/$id/holdings")({
  server: {
    handlers: {
      GET: ({ params }) => respond(() => listHoldings(id(params.id))),
    },
  },
})
