import { createFileRoute } from "@tanstack/react-router"
import {
  createSession,
  sessionCookie,
  setPassword,
  verifyPassword,
} from "@/server/auth"
import { loadConfig } from "@/server/config"
import { body, respond } from "@/server/http"
import type { PasswordChange } from "@/shared/setup"

/**
 * Changes the password with { current, next }. Every other session is signed
 * out; this browser gets a new one.
 */
export const Route = createFileRoute("/api/password")({
  server: {
    handlers: {
      POST: ({ request }) =>
        respond(async () => {
          const { current, next } = await body<PasswordChange>(request)
          if (
            typeof current !== "string" ||
            !verifyPassword(current, loadConfig().passwordHash ?? "")
          ) {
            return Response.json(
              { error: "the current password is wrong" },
              { status: 400 }
            )
          }
          setPassword(next)
          return new Response(null, {
            status: 204,
            headers: { "set-cookie": sessionCookie(createSession()) },
          })
        }),
    },
  },
})
