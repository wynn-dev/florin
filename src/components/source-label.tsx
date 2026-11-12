import type { Actor } from "@/shared/types"

/**
 * Who made a change, in words: "You", the MCP client's name, "Bank sync",
 * "Import", "Demo data". Plain text, never an icon or avatar. Pass the bank's
 * name or the file's name when you have it ("Revolut sync", "Import
 * (revolut-oct.csv)").
 */
export function sourceName(
  actor: Actor,
  detail: { bank?: string; file?: string } = {}
): string {
  if (actor === "person") return "You"
  if (actor === "bank-sync")
    return detail.bank ? `${detail.bank} sync` : "Bank sync"
  if (actor === "import")
    return detail.file ? `Import (${detail.file})` : "Import"
  if (actor === "demo") return "Demo data"
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
