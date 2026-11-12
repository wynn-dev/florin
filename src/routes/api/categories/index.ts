import { createFileRoute } from "@tanstack/react-router"
import { createCategory, listCategoryGroups } from "@/server/data"
import { body, respond } from "@/server/http"

/** GET lists groups with their categories; POST { groupId, name } adds a category. */
export const Route = createFileRoute("/api/categories/")({
  server: {
    handlers: {
      GET: () => respond(listCategoryGroups),
      POST: ({ request }) =>
        respond(async () =>
          createCategory(
            "person",
            await body<{ groupId: number; name: string }>(request)
          )
        ),
    },
  },
})
