import { createFileRoute } from "@tanstack/react-router"
import { isSignedIn, needsSetup } from "@/server/auth"
import { setupStatus } from "@/server/data"
import { respond } from "@/server/http"

/** Which first-run steps still apply. Open to anyone only until a password exists. */
export const Route = createFileRoute("/api/setup/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        respond(() =>
          needsSetup() || isSignedIn(request)
            ? setupStatus()
            : Response.json({ error: "sign in first" }, { status: 401 })
        ),
    },
  },
})
