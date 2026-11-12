import { createFileRoute } from "@tanstack/react-router"
import { listAccountValues, setAccountValue } from "@/server/data"
import { body, id, respond } from "@/server/http"
import type { AccountValue } from "@/shared/types"

export const Route = createFileRoute("/api/accounts/$id/values")({
  server: {
    handlers: {
      GET: ({ params }) => respond(() => listAccountValues(id(params.id))),
      PUT: ({ request, params }) =>
        respond(async () => {
          const { date, value } = await body<AccountValue>(request)
          setAccountValue("person", id(params.id), date, value)
          return listAccountValues(id(params.id))
        }),
    },
  },
})
