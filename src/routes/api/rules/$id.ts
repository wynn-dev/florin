import { createFileRoute } from "@tanstack/react-router"
import { deleteRules } from "@/server/data"
import { id, respond } from "@/server/http"

export const Route = createFileRoute("/api/rules/$id")({
  server: {
    handlers: {
      DELETE: ({ params }) =>
        respond(() => deleteRules("person", [id(params.id)])),
    },
  },
})
