import { createFileRoute } from "@tanstack/react-router"
import { createMcpToken, listMcpTokens } from "@/server/data"
import { body, respond } from "@/server/http"
import type { McpTokenList, NewMcpToken } from "@/shared/mcp"

export const Route = createFileRoute("/api/mcp-tokens/")({
  server: {
    handlers: {
      GET: () => respond((): McpTokenList => ({ items: listMcpTokens() })),
      /** { name } answers { id, name, token }: the only time the token is shown. */
      POST: ({ request }) =>
        respond(async () =>
          createMcpToken("person", (await body<NewMcpToken>(request)).name)
        ),
    },
  },
})
