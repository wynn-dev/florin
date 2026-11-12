import { createFileRoute } from "@tanstack/react-router"
import { importCsv, importTransactions } from "@/server/data"
import { body, id, respond } from "@/server/http"
import type { CsvMapping, ImportRow } from "@/shared/types"

/**
 * Body: { csv, mapping, fileName? } for a CSV file, or { rows } for rows
 * already parsed. With a file name, Activity shows "Import (<file name>)".
 */
export const Route = createFileRoute("/api/accounts/$id/import")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        respond(async () => {
          const input = await body<{
            csv?: string
            mapping?: CsvMapping
            rows?: ImportRow[]
            fileName?: string
          }>(request)
          const name =
            typeof input.fileName === "string"
              ? input.fileName.trim().slice(0, 200)
              : ""
          const actor = name ? (`import:${name}` as const) : "import"
          if (typeof input.csv === "string" && input.mapping)
            return importCsv(actor, id(params.id), input.csv, input.mapping)
          return importTransactions(actor, id(params.id), input.rows ?? [])
        }),
    },
  },
})
