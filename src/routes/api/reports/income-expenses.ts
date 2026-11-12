import { createFileRoute } from "@tanstack/react-router"
import { incomeVsExpenses } from "@/server/data"
import { query, respond } from "@/server/http"

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD, by default the last twelve months. */
export const Route = createFileRoute("/api/reports/income-expenses")({
  server: {
    handlers: {
      GET: ({ request }) => respond(() => incomeVsExpenses(query(request))),
    },
  },
})
