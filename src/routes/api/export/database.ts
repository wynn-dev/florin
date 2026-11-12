import { createFileRoute } from "@tanstack/react-router"
import { databaseCopy } from "@/server/data"
import { respond } from "@/server/http"
import { today } from "@/server/data/validate"

/** A consistent copy of florin.db, as a download. */
export const Route = createFileRoute("/api/export/database")({
  server: {
    handlers: {
      GET: () =>
        respond(
          () =>
            new Response(databaseCopy(), {
              headers: {
                "content-type": "application/vnd.sqlite3",
                "content-disposition": `attachment; filename="florin-${today()}.db"`,
              },
            })
        ),
    },
  },
})
