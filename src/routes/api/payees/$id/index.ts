import { createFileRoute } from "@tanstack/react-router"
import {
  deletePayee,
  getPayee,
  renamePayee,
  setPayeeCategory,
} from "@/server/data"
import { body, id, respond } from "@/server/http"

export const Route = createFileRoute("/api/payees/$id/")({
  server: {
    handlers: {
      /** { name } renames; { defaultCategoryId } sets or (null) clears the default category. */
      PATCH: ({ request, params }) =>
        respond(async () => {
          const patch = await body<{
            name?: string
            defaultCategoryId?: number | null
          }>(request)
          let payee = getPayee(id(params.id))
          if (patch.name !== undefined)
            payee = renamePayee("person", payee.id, patch.name)
          if (patch.defaultCategoryId !== undefined)
            payee = setPayeeCategory(
              "person",
              payee.id,
              patch.defaultCategoryId
            )
          return payee
        }),
      DELETE: ({ params }) =>
        respond(() => deletePayee("person", id(params.id))),
    },
  },
})
