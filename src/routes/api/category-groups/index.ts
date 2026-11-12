import { createFileRoute } from "@tanstack/react-router"
import { createCategoryGroup } from "@/server/data"
import { body, respond } from "@/server/http"

export const Route = createFileRoute("/api/category-groups/")({
  server: {
    handlers: {
      POST: ({ request }) =>
        respond(async () =>
          createCategoryGroup(
            "person",
            await body<{ name: string; isIncome?: boolean }>(request)
          )
        ),
    },
  },
})
