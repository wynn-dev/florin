import { createFileRoute } from "@tanstack/react-router"
import { body } from "@/server/http"
import {
  connectIbkr,
  disconnectIbkr,
  getIbkrStatus,
  respondIbkr,
} from "@/server/ibkr"
import type { IbkrCredentials } from "@/shared/ibkr"

/**
 * The IBKR connection: GET its status (never the token), PUT a token and/or
 * query id (kept only once a pull with them works), DELETE to disconnect
 * (the accounts and their history stay).
 */
export const Route = createFileRoute("/api/connections/ibkr/")({
  server: {
    handlers: {
      GET: () => respondIbkr(() => getIbkrStatus()),
      PUT: ({ request }) =>
        respondIbkr(async () =>
          connectIbkr("person", await body<IbkrCredentials>(request))
        ),
      DELETE: () => respondIbkr(() => disconnectIbkr("person")),
    },
  },
})
