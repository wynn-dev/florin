import { createFileRoute } from "@tanstack/react-router"
import { testRule } from "@/server/data"
import { body, respond } from "@/server/http"

/** Body: { pattern, payee? }; answers how many existing transactions it matches, with examples. */
export const Route = createFileRoute("/api/rules/test")({
  server: {
    handlers: {
      POST: ({ request }) =>
        respond(async () =>
          testRule(await body<{ pattern: string; payee?: string }>(request))
        ),
    },
  },
})
