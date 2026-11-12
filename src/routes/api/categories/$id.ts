import { createFileRoute } from "@tanstack/react-router"
import { deleteCategory, updateCategory } from "@/server/data"
import { body, id, optionalInt, query, respond } from "@/server/http"

export const Route = createFileRoute("/api/categories/$id")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        respond(async () =>
          updateCategory(
            "person",
            id(params.id),
            await body<{
              name?: string
              hidden?: boolean
              groupId?: number
              outsideGoal?: boolean
            }>(request)
          )
        ),
      /** ?transferTo=<categoryId> moves the category's transactions there first. */
      DELETE: ({ request, params }) =>
        respond(() =>
          deleteCategory(
            "person",
            id(params.id),
            optionalInt(query(request).transferTo)
          )
        ),
    },
  },
})
