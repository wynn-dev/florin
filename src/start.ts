import { createMiddleware, createStart } from "@tanstack/react-start"
import { isSignedIn, needsSetup } from "./server/auth"

// Everything but sign-in, first-run setup and their endpoints needs a
// session. Until a password exists every page leads to /setup; once it
// exists, /setup's later steps run on the session its first step created.
// /mcp checks its own access token instead (src/server/mcp/http.ts).
const PUBLIC = new Set(["/login", "/api/session", "/api/setup", "/mcp"])

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { location } })
}

const requireSession = createMiddleware().server(async ({ next, request }) => {
  const { pathname } = new URL(request.url)
  const api = pathname.startsWith("/api/") || pathname === "/mcp"
  if (!api && needsSetup())
    return pathname === "/setup" ? next() : redirect("/setup")
  if (PUBLIC.has(pathname) || isSignedIn(request)) return next()
  if (api) return Response.json({ error: "sign in first" }, { status: 401 })
  return redirect("/login")
})

export const startInstance = createStart(() => ({
  requestMiddleware: [requireSession],
}))
