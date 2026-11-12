import { createFileRoute } from "@tanstack/react-router"
import { getActivityEntry } from "@/server/data"
import { id, respond } from "@/server/http"

/** One Activity entry by its id. */
export const Route = createFileRoute("/api/activity/$id")({
  server: {
    handlers: {
      GET: ({ params }) => respond(() => getActivityEntry(id(params.id))),
    },
  },
})
