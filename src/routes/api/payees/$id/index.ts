import { createFileRoute } from "@tanstack/react-router"
import { deletePayee, renamePayee } from "@/server/data"
import { body, id, respond } from "@/server/http"

export const Route = createFileRoute("/api/payees/$id/")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        respond(async () =>
          renamePayee(
            "person",
            id(params.id),
            (await body<{ name: string }>(request)).name
          )
        ),
      DELETE: ({ params }) =>
        respond(() => deletePayee("person", id(params.id))),
    },
  },
})
