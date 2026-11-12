import { createFileRoute } from "@tanstack/react-router"
import { deleteAccount, getAccount, updateAccount } from "@/server/data"
import { body, id, respond } from "@/server/http"
import type { AccountPatch } from "@/shared/types"

export const Route = createFileRoute("/api/accounts/$id/")({
  server: {
    handlers: {
      GET: ({ params }) => respond(() => getAccount(id(params.id))),
      PATCH: ({ request, params }) =>
        respond(async () =>
          updateAccount(
            "person",
            id(params.id),
            await body<AccountPatch>(request)
          )
        ),
      DELETE: ({ params }) =>
        respond(() => deleteAccount("person", id(params.id))),
    },
  },
})
