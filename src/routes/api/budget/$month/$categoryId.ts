import { createFileRoute } from "@tanstack/react-router"
import { setBudgetAmount } from "@/server/data"
import { body, id, respond } from "@/server/http"

/** PUT { amount } sets what is assigned to the category that month; answers the whole month. */
export const Route = createFileRoute("/api/budget/$month/$categoryId")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        respond(async () =>
          setBudgetAmount(
            "person",
            params.month,
            id(params.categoryId),
            (await body<{ amount: number }>(request)).amount
          )
        ),
    },
  },
})
