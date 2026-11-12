import { createFileRoute } from "@tanstack/react-router"
import { disconnectLink } from "@/server/enablebanking"
import { id, respond } from "@/server/http"

/** Disconnects a bank: florin stops syncing it; its accounts keep their transactions. */
export const Route = createFileRoute(
  "/api/connections/enable-banking/links/$id/"
)({
  server: {
    handlers: {
      DELETE: ({ params }) =>
        respond(() => disconnectLink("person", id(params.id))),
    },
  },
})
