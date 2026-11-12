// /mcp: streamable HTTP, stateless (a fresh server per request, JSON answers),
// guarded by an access token from settings rather than the dashboard session.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { useMcpToken } from "../data/tokens"
import { createMcpServer } from "./server"

function unauthorized(message: string): Response {
  return Response.json(
    { error: message },
    {
      status: 401,
      headers: { "www-authenticate": 'Bearer realm="florin"' },
    }
  )
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  const header = request.headers.get("authorization") ?? ""
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (!match)
    return unauthorized(
      "florin's MCP needs an access token: create one in Settings and send it as the header Authorization: Bearer <token>"
    )
  const token = useMcpToken(match[1])
  if (!token)
    return unauthorized(
      "this access token is not valid; it may have been revoked. Create a new one in Settings"
    )
  if (request.method !== "POST")
    return Response.json(
      { error: "florin's MCP is stateless: send requests with POST" },
      { status: 405, headers: { allow: "POST" } }
    )
  const server = createMcpServer(() => `mcp:${token.name}`)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  try {
    return await transport.handleRequest(request)
  } finally {
    await server.close()
  }
}
