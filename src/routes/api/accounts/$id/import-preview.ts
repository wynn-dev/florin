import { createFileRoute } from "@tanstack/react-router"
import { previewCsv } from "@/server/data"
import { body, id, respond } from "@/server/http"
import type { CsvMapping } from "@/shared/types"

/**
 * Body: { csv, mapping? }. Reads the file without importing it: headers, the
 * first rows, the mapping (florin's guess when none is given) and how many
 * rows are new and how many the account already has.
 */
export const Route = createFileRoute("/api/accounts/$id/import-preview")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        respond(async () => {
          const input = await body<{ csv?: string; mapping?: CsvMapping }>(
            request
          )
          return previewCsv(id(params.id), input.csv as string, input.mapping)
        }),
    },
  },
})
