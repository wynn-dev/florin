import { createFileRoute } from "@tanstack/react-router"
import { incomeExpenseReport, reportQuery } from "@/server/data"
import { query, respond } from "@/server/http"

/** Income and expenses per month. ?from, to, all, accounts as for net-worth. */
export const Route = createFileRoute("/api/reports/income-expenses")({
  server: {
    handlers: {
      GET: ({ request }) =>
        respond(() => incomeExpenseReport(reportQuery(query(request)))),
    },
  },
})
