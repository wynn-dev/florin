import { createFileRoute } from "@tanstack/react-router"
import { getSettings, updateSettings } from "@/server/data"
import { body, respond } from "@/server/http"
import type { Settings } from "@/shared/types"

export const Route = createFileRoute("/api/settings")({
  server: {
    handlers: {
      GET: () => respond(getSettings),
      PATCH: ({ request }) =>
        respond(async () =>
          updateSettings("person", await body<Partial<Settings>>(request))
        ),
    },
  },
})
