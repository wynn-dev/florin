// florin's MCP server, served over streamable HTTP at /mcp (see http.ts).
// Tools call the data layer directly.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { annotations, callTool } from "./tool"
import { tools } from "./tools"
import type { ToolContext } from "./tool"
import pkg from "../../../package.json"

export const INSTRUCTIONS = `florin is an envelope budget. Start with the overview tool.
- Money is integer minor units (cents) in the currency named beside it; negative = money out, positive = money in.
- The budget has one currency. Each month money is assigned (budgeted) to expense categories. A category's available amount is everything assigned to it to date plus all its activity to date, so leftovers and overspending carry into the next month. Income is booked to categories in income groups and becomes "to budget": all income to date minus all assigned to date (negative = over-assigned).
- On-budget accounts feed the budget and their transactions need a category. Tracking accounts (off budget: investments, other currencies) only count in net worth and need no categories.
- A transfer is a linked pair of transactions in two accounts, made in one call; between currencies each side has its own amount. A transfer between on-budget accounts takes no category.
- Pending transactions are not yet settled by the bank; cleared ones are.
- Rules (list_rules, save_rules) name and categorise every imported row from the bank's text; to keep a kind of row categorised, add a rule rather than fixing each one.
- Bulk tools take lists and apply all of them or none; an error names the item to fix. Every change is recorded with who made it.`

/** A server with every tool; `actor` names whoever is calling, for the change log. */
export function createMcpServer(actor: ToolContext["actor"]): McpServer {
  const server = new McpServer(
    { name: "florin", version: pkg.version },
    { instructions: INSTRUCTIONS }
  )
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: annotations(tool),
      },
      (args: unknown) => callTool(tool, args, { actor })
    )
  }
  return server
}
