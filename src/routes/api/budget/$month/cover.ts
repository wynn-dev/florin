import { createFileRoute } from "@tanstack/react-router"
import { coverOverspending } from "@/server/data"
import { respond } from "@/server/http"

/**
 * POST covers the month's overspending from the money not planned yet: each
 * category over plan gets its plan raised by what it is over, all or none.
 * Answers the month and what each category got.
 */
export const Route = createFileRoute("/api/budget/$month/cover")({
  server: {
    handlers: {
      POST: ({ params }) =>
        respond(() => coverOverspending("person", params.month)),
    },
  },
})
