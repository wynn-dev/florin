import { createFileRoute } from "@tanstack/react-router"
import { deleteCategoryGroup, renameCategoryGroup } from "@/server/data"
import { body, id, optionalInt, query, respond } from "@/server/http"

export const Route = createFileRoute("/api/category-groups/$id")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        respond(async () =>
          renameCategoryGroup(
            "person",
            id(params.id),
            (await body<{ name: string }>(request)).name
          )
        ),
      /** ?transferTo=<categoryId> moves its categories' transactions and budgets there first. */
      DELETE: ({ request, params }) =>
        respond(() =>
          deleteCategoryGroup(
            "person",
            id(params.id),
            optionalInt(query(request).transferTo)
          )
        ),
    },
  },
})
