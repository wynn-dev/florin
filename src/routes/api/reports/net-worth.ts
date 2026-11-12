import { createFileRoute } from "@tanstack/react-router"
import { netWorthReport, reportQuery } from "@/server/data"
import { query, respond } from "@/server/http"

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (default the last twelve months), all=true for all time, accounts=1,2 to pick accounts, step=day|week|month (default month, day for three months or less). */
export const Route = createFileRoute("/api/reports/net-worth")({
  server: {
    handlers: {
      GET: ({ request }) =>
        respond(() => netWorthReport(reportQuery(query(request)))),
    },
  },
})
