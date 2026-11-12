// The shape of an MCP tool. Each tool is a small definition: a name, a
// description written for an agent, a zod input shape, what kind of tool it is
// (read, write or destructive, which sets its annotations) and a `run` that
// calls the data layer and returns plain data, sent back as compact JSON.
import { InvalidInput, NotFound } from "../data/validate"
import type { z } from "zod"
import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js"
import type { Actor } from "@/shared/types"

export type ToolContext = {
  /** Who the change log names for writes: "mcp:<token or client name>". */
  actor: () => Actor
}

export type FlorinTool<TShape extends z.ZodRawShape = z.ZodRawShape> = {
  name: string
  title: string
  description: string
  input: TShape
  /** read: changes nothing; write: adds or changes; destructive: deletes or merges. */
  kind: "read" | "write" | "destructive"
  /** Setting the same thing twice has no further effect. */
  idempotent?: boolean
  run: (args: z.infer<z.ZodObject<TShape>>, ctx: ToolContext) => unknown
}

export function defineTool<TShape extends z.ZodRawShape>(
  tool: FlorinTool<TShape>
): FlorinTool {
  return tool as unknown as FlorinTool
}

export function annotations(tool: FlorinTool): ToolAnnotations {
  return {
    title: tool.title,
    readOnlyHint: tool.kind === "read",
    destructiveHint: tool.kind === "destructive",
    idempotentHint: tool.kind === "read" || Boolean(tool.idempotent),
    openWorldHint: false,
  }
}

/** Runs a tool, answering its result as JSON and data-layer refusals as tool errors the agent can act on. */
export async function callTool(
  tool: FlorinTool,
  args: unknown,
  ctx: ToolContext
): Promise<CallToolResult> {
  try {
    const result = await tool.run(args as never, ctx)
    return {
      content: [{ type: "text", text: JSON.stringify(result ?? { ok: true }) }],
    }
  } catch (error) {
    if (error instanceof InvalidInput || error instanceof NotFound) {
      const hint =
        error instanceof NotFound
          ? " (look the id up with overview, list_accounts, list_categories, list_payees or search_transactions)"
          : ""
      return {
        isError: true,
        content: [{ type: "text", text: `${error.message}${hint}` }],
      }
    }
    console.error(error)
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `florin hit an unexpected error: ${(error as Error).message}`,
        },
      ],
    }
  }
}
