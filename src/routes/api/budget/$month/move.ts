import { createFileRoute } from "@tanstack/react-router"
import { moveBudgetAmounts } from "@/server/data"
import { body, respond } from "@/server/http"
import type { BudgetMove } from "@/server/data"

/**
 * POST { moves: [{ fromCategoryId, toCategoryId, amount }] } moves money
 * between categories that month; null on either side is Ready to assign.
 * Answers the month.
 */
export const Route = createFileRoute("/api/budget/$month/move")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        respond(async () =>
          moveBudgetAmounts(
            "person",
            params.month,
            (await body<{ moves: BudgetMove[] }>(request)).moves
          )
        ),
    },
  },
})
