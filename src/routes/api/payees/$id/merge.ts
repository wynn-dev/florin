import { createFileRoute } from "@tanstack/react-router"
import { mergePayees } from "@/server/data"
import { body, id, respond } from "@/server/http"

/** Body: { ids } — payees whose transactions move to this one before they are deleted. */
export const Route = createFileRoute("/api/payees/$id/merge")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        respond(async () =>
          mergePayees(
            "person",
            id(params.id),
            (await body<{ ids: number[] }>(request)).ids ?? []
          )
        ),
    },
  },
})
