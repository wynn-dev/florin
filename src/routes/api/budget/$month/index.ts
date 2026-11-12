import { createFileRoute } from "@tanstack/react-router"
import { getBudgetMonth, setBudgetAmounts } from "@/server/data"
import { body, respond } from "@/server/http"
import type { BudgetAmount } from "@/shared/types"

export const Route = createFileRoute("/api/budget/$month/")({
  server: {
    handlers: {
      GET: ({ params }) => respond(() => getBudgetMonth(params.month)),
      /** { amounts: [{ categoryId, amount }] } sets several categories at once; answers the month. */
      PUT: ({ request, params }) =>
        respond(async () =>
          setBudgetAmounts(
            "person",
            params.month,
            (await body<{ amounts: BudgetAmount[] }>(request)).amounts ?? []
          )
        ),
    },
  },
})
