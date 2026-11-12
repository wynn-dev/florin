import { createFileRoute } from "@tanstack/react-router"
import { setMonthlyGoal } from "@/server/data"
import { body, respond } from "@/server/http"

/** PUT { amount } sets the monthly spending goal; { amount: null } removes it. */
export const Route = createFileRoute("/api/budget/goal")({
  server: {
    handlers: {
      PUT: ({ request }) =>
        respond(async () => ({
          amount: setMonthlyGoal(
            "person",
            (await body<{ amount: number | null }>(request)).amount
          ),
        })),
    },
  },
})
