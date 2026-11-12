import { createFileRoute } from "@tanstack/react-router"
import { pullIbkr, respondIbkr } from "@/server/ibkr"

/** Pulls the Flex report now and answers the status once it is stored (429 when IBKR's limits don't allow it yet). */
export const Route = createFileRoute("/api/connections/ibkr/pull")({
  server: {
    handlers: {
      POST: () => respondIbkr(() => pullIbkr()),
    },
  },
})
