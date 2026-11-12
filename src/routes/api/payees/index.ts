import { createFileRoute } from "@tanstack/react-router"
import { createPayee, listPayees } from "@/server/data"
import { body, optionalInt, query, respond } from "@/server/http"

/** GET ?search&limit&offset answers { items, total }. */
export const Route = createFileRoute("/api/payees/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        respond(() => {
          const q = query(request)
          return listPayees({
            search: q.search,
            limit: optionalInt(q.limit),
            offset: optionalInt(q.offset),
          })
        }),
      POST: ({ request }) =>
        respond(async () =>
          createPayee("person", (await body<{ name: string }>(request)).name)
        ),
    },
  },
})
