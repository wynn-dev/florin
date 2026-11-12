import { createFileRoute } from "@tanstack/react-router"
import { cashFlowReport, reportQuery } from "@/server/data"
import { query, respond } from "@/server/http"

/** Cash accounts' flows and balances per month. ?from, to, all, accounts as for net-worth. */
export const Route = createFileRoute("/api/reports/cash-flow")({
  server: {
    handlers: {
      GET: ({ request }) =>
        respond(() => cashFlowReport(reportQuery(query(request)))),
    },
  },
})
