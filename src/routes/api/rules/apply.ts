import { createFileRoute } from "@tanstack/react-router"
import { applyRules } from "@/server/data"
import { body, respond } from "@/server/http"
import type { ApplyRulesOptions } from "@/shared/types"

/** Body: ApplyRulesOptions ({ dryRun: true } to see what would change). */
export const Route = createFileRoute("/api/rules/apply")({
  server: {
    handlers: {
      POST: ({ request }) =>
        respond(async () =>
          applyRules("person", await body<ApplyRulesOptions>(request))
        ),
    },
  },
})
