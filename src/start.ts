import { createMiddleware, createStart } from "@tanstack/react-start"
import { isSignedIn } from "./server/auth"

// Everything but the sign-in page and the session endpoint needs a session.
// /mcp checks its own access token instead (src/server/mcp/http.ts).
const PUBLIC = new Set(["/login", "/api/session", "/mcp"])

const requireSession = createMiddleware().server(async ({ next, request }) => {
  const { pathname } = new URL(request.url)
  if (PUBLIC.has(pathname) || isSignedIn(request)) return next()
  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "sign in first" }, { status: 401 })
  }
  return new Response(null, { status: 302, headers: { location: "/login" } })
})

export const startInstance = createStart(() => ({
  requestMiddleware: [requireSession],
}))
