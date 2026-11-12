// Actions the command palette (⌘K) starts on another page: it navigates there,
// then runs the command. A page that offers one registers it with useCommand
// while it is mounted; a command run before its page has mounted waits for it.
//
//   useCommand("new-transaction", () => setSheetOpen(true))
import { useEffect, useRef } from "react"

export type CommandName = "new-transaction" | "import-csv"

/** How long a command waits for its page to mount before it is dropped. */
const WAIT_MS = 3_000

const handlers = new Map<CommandName, () => void>()
let pending: { name: CommandName; at: number } | null = null

/** Runs a command now if its page is mounted, else as soon as it mounts. */
export function runCommand(name: CommandName): void {
  const handler = handlers.get(name)
  if (handler) handler()
  else pending = { name, at: Date.now() }
}

/** Registers what a command does on this page, for as long as it is mounted. */
export function useCommand(name: CommandName, handler: () => void): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const run = () => ref.current()
    handlers.set(name, run)
    if (pending?.name === name) {
      const fresh = Date.now() - pending.at < WAIT_MS
      pending = null
      if (fresh) run()
    }
    return () => {
      if (handlers.get(name) === run) handlers.delete(name)
    }
  }, [name])
}
