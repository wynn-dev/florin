import { createFileRoute } from "@tanstack/react-router"
import { spendingReport, reportQuery } from "@/server/data"
import { query, respond } from "@/server/http"

/** Spending by group and category, against the period before. ?from, to, all, accounts as for net-worth. */
export const Route = createFileRoute("/api/reports/spending")({
  server: {
    handlers: {
      GET: ({ request }) =>
        respond(() => spendingReport(reportQuery(query(request)))),
    },
  },
})
