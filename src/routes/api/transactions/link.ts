import { createFileRoute } from "@tanstack/react-router"
import { linkTransfers } from "@/server/data"
import { body, respond } from "@/server/http"

export const Route = createFileRoute("/api/transactions/link")({
  server: {
    handlers: {
      /** { pairs: [[id, id], …] }: links each pair of existing transactions as one transfer, all or none. */
      POST: ({ request }) =>
        respond(async () =>
          linkTransfers(
            "person",
            (await body<{ pairs: [number, number][] }>(request)).pairs
          )
        ),
    },
  },
})
