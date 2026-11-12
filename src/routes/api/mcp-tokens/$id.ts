import { createFileRoute } from "@tanstack/react-router"
import { deleteMcpToken } from "@/server/data"
import { id, respond } from "@/server/http"

export const Route = createFileRoute("/api/mcp-tokens/$id")({
  server: {
    handlers: {
      /** Revokes the token: its clients get 401 from the next request on. */
      DELETE: ({ params }) =>
        respond(() => deleteMcpToken("person", id(params.id))),
    },
  },
})
