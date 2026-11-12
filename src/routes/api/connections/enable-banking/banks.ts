import { createFileRoute } from "@tanstack/react-router"
import { listBanks } from "@/server/enablebanking"
import { query, respond } from "@/server/http"

/** ?country=FI → the banks Enable Banking can link there, by name. */
export const Route = createFileRoute("/api/connections/enable-banking/banks")({
  server: {
    handlers: {
      GET: ({ request }) => respond(() => listBanks(query(request).country)),
    },
  },
})
