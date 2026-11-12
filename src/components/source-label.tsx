import type { Actor } from "@/shared/types"

/**
 * Who made a change, in words: "You", the MCP client's name, "Revolut sync",
 * "IBKR", "Import (revolut-oct.csv)", "Demo data". Plain text, never an icon
 * or avatar. Actors carry the bank's or file's name ("bank-sync:Revolut",
 * "import:revolut-oct.csv"); for the bare forms, pass it when you have it.
 */
export function sourceName(
  actor: Actor,
  detail: { bank?: string; file?: string } = {}
): string {
  if (actor === "person") return "You"
  if (actor === "ibkr") return "IBKR"
  if (actor === "demo") return "Demo data"
  if (actor === "bank-sync")
    return detail.bank ? `${detail.bank} sync` : "Bank sync"
  if (actor === "import")
    return detail.file ? `Import (${detail.file})` : "Import"
  if (actor.startsWith("bank-sync:")) return `${actor.slice(10)} sync`
  if (actor.startsWith("import:")) return `Import (${actor.slice(7)})`
  if (actor.startsWith("mcp:")) return actor.slice(4) || "MCP client"
  return actor
}

export function SourceLabel({
  actor,
  bank,
  file,
  className,
}: {
  actor: Actor
  bank?: string
  file?: string
  className?: string
}) {
  return (
    <span className={className ?? "font-medium"}>
      {sourceName(actor, { bank, file })}
    </span>
  )
}
