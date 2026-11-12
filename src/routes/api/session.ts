import { createFileRoute } from "@tanstack/react-router"
import {
  createSession,
  isSignedIn,
  needsSetup,
  sessionCookie,
  setPassword,
  verifyPassword,
} from "@/server/auth"
import { loadConfig } from "@/server/config"
import { body, respond } from "@/server/http"

export const Route = createFileRoute("/api/session")({
  server: {
    handlers: {
      /** Whether this browser is signed in, and whether florin still needs its first password. */
      GET: ({ request }) =>
        respond(() => ({
          signedIn: isSignedIn(request),
          needsSetup: needsSetup(),
        })),

      /** Signs in; on first run this sets the password. */
      POST: ({ request }) =>
        respond(async () => {
          const { password } = await body<{ password: string }>(request)
          if (needsSetup()) setPassword(password)
          else if (
            typeof password !== "string" ||
            !verifyPassword(password, loadConfig().passwordHash!)
          ) {
            return Response.json({ error: "wrong password" }, { status: 401 })
          }
          return Response.json(
            { signedIn: true, needsSetup: false },
            { headers: { "set-cookie": sessionCookie(createSession()) } }
          )
        }),

      DELETE: () =>
        respond(
          () =>
            new Response(null, {
              status: 204,
              headers: { "set-cookie": sessionCookie("", 0) },
            })
        ),
    },
  },
})
