import { createFileRoute } from "@tanstack/react-router"
import { getBudgetCategoryDetail, setBudgetAmount } from "@/server/data"
import { body, id, respond } from "@/server/http"

export const Route = createFileRoute("/api/budget/$month/$categoryId")({
  server: {
    handlers: {
      /** The category's last twelve months of spending and its latest budget change. */
      GET: ({ params }) =>
        respond(() =>
          getBudgetCategoryDetail(params.month, id(params.categoryId))
        ),
      /** PUT { amount } sets what is assigned to the category that month; answers the whole month. */
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
