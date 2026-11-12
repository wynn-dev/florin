import { createFileRoute } from "@tanstack/react-router"
import { listRules, saveRules } from "@/server/data"
import { body, respond } from "@/server/http"
import type { RuleInput } from "@/shared/types"

/** GET answers the rules in order; POST { rules } creates and changes them, all or none. */
export const Route = createFileRoute("/api/rules/")({
  server: {
    handlers: {
      GET: () => respond(() => listRules()),
      POST: ({ request }) =>
        respond(async () =>
          saveRules(
            "person",
            (await body<{ rules: RuleInput[] }>(request)).rules
          )
        ),
    },
  },
})
