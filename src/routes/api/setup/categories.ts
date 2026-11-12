import { createFileRoute } from "@tanstack/react-router"
import { applyStarterCategories } from "@/server/data"
import { body, respond } from "@/server/http"
import type { StarterCategories } from "@/shared/setup"

/** Replaces the starter categories with { groups }, while none are in use. */
export const Route = createFileRoute("/api/setup/categories")({
  server: {
    handlers: {
      POST: ({ request }) =>
        respond(async () => {
          applyStarterCategories(
            "person",
            await body<StarterCategories>(request)
          )
        }),
    },
  },
})
