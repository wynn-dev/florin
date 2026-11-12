import { createFileRoute } from "@tanstack/react-router"
import { importCsv, importTransactions } from "@/server/data"
import { body, id, respond } from "@/server/http"
import type { CsvMapping, ImportRow } from "@/shared/types"

/** Body: { csv, mapping } for a CSV file, or { rows } for rows already parsed. */
export const Route = createFileRoute("/api/accounts/$id/import")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        respond(async () => {
          const input = await body<{
            csv?: string
            mapping?: CsvMapping
            rows?: ImportRow[]
          }>(request)
          if (typeof input.csv === "string" && input.mapping)
            return importCsv("import", id(params.id), input.csv, input.mapping)
          return importTransactions("import", id(params.id), input.rows ?? [])
        }),
    },
  },
})
