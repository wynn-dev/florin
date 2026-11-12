import { createFileRoute } from "@tanstack/react-router"
import { createAccount, listAccounts } from "@/server/data"
import { body, respond } from "@/server/http"
import type { NewAccount } from "@/shared/types"

export const Route = createFileRoute("/api/accounts/")({
  server: {
    handlers: {
      GET: () => respond(listAccounts),
      POST: ({ request }) =>
        respond(async () =>
          createAccount("person", await body<NewAccount>(request))
        ),
    },
  },
})
