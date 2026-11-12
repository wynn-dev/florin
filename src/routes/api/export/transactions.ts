import { createFileRoute } from "@tanstack/react-router"
import { transactionsCsv } from "@/server/data"
import { respond } from "@/server/http"
import { today } from "@/server/data/validate"

/** Every transaction as CSV, as a download. */
export const Route = createFileRoute("/api/export/transactions")({
  server: {
    handlers: {
      GET: () =>
        respond(
          () =>
            new Response(transactionsCsv(), {
              headers: {
                "content-type": "text/csv; charset=utf-8",
                "content-disposition": `attachment; filename="florin-transactions-${today()}.csv"`,
              },
            })
        ),
    },
  },
})
