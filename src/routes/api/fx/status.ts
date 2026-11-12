import { createFileRoute } from "@tanstack/react-router"
import { fxStatus } from "@/server/ecb"
import { respond } from "@/server/http"
import "@/server/job-list"

export const Route = createFileRoute("/api/fx/status")({
  server: {
    handlers: {
      GET: () => respond(fxStatus),
    },
  },
})
