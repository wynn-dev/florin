import { createFileRoute } from "@tanstack/react-router"
import { spendingByDay } from "@/server/data"
import { query, respond } from "@/server/http"

/** Cumulative spending per day of ?month=YYYY-MM (default this month) and the month before. */
export const Route = createFileRoute("/api/reports/spending-by-day")({
  server: {
    handlers: {
      GET: ({ request }) => respond(() => spendingByDay(query(request).month)),
    },
  },
})
