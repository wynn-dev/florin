import { createFileRoute } from "@tanstack/react-router"
import {
  checkPassword,
  checkSetupCode,
  createSession,
  isSignedIn,
  needsSetup,
  sessionCookie,
  setPassword,
  verifyPassword,
} from "@/server/auth"
import { loadConfig } from "@/server/config"
import { updateSettings } from "@/server/data"
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

      /**
       * Signs in with { password }. On first run, { setupCode, password } sets
       * the password; the code is the one `florin start` printed. The first
       * run may also carry { currency, locale }, saved before the password so
       * a bad value leaves florin unclaimed.
       */
      POST: ({ request }) =>
        respond(async () => {
          const { password, setupCode, currency, locale } = await body<{
            password: string
            setupCode?: string
            currency?: string
            locale?: string
          }>(request)
          if (needsSetup()) {
            if (!checkSetupCode(setupCode)) {
              return Response.json(
                { error: "wrong setup code; run florin setup-code to see it" },
                { status: 401 }
              )
            }
            checkPassword(password)
            if (currency !== undefined || locale !== undefined)
              updateSettings("person", { currency, locale })
            setPassword(password)
          } else if (
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
