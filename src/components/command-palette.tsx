// ⌘K / Ctrl K: go anywhere, start an action, or find a transaction.
import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { openAccounts } from "@/components/app-sidebar"
import { useConnections } from "@/components/sync-status"
import { Money } from "@/components/money"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { queries } from "@/lib/api"
import { runCommand } from "@/lib/commands"
import type { CommandName } from "@/lib/commands"
import { formatDate, formatMonth, today } from "@/lib/format"
import { useTheme } from "@/lib/theme"

/** "2026-11" and n months from it. */
function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [theme, setTheme] = useTheme()
  const allAccounts = useQuery(queries.accounts()).data
  const accounts = openAccounts(allAccounts)
  const connections = useConnections()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const term = useDebounced(search.trim(), 150)
  const matches = useQuery({
    ...queries.transactions({ search: term, limit: 5 }),
    enabled: open && term.length >= 2,
    placeholderData: (previous) => previous,
  })

  const thisMonth = today().slice(0, 7)
  const lastMonth = addMonths(thisMonth, -1)

  function go(fn: () => unknown) {
    setOpen(false)
    setSearch("")
    void fn()
  }
  const to = (path: string, params?: Record<string, unknown>) => () =>
    navigate({ to: path as "/", search: params as never })
  const command = (path: string, name: CommandName) => async () => {
    await navigate({ to: path as "/" })
    runCommand(name)
  }

  async function syncAll() {
    const results = await Promise.allSettled(connections.map((c) => c.run()))
    void queryClient.invalidateQueries({ queryKey: ["enable-banking"] })
    void queryClient.invalidateQueries({ queryKey: ["connections", "ibkr"] })
    const failed = results.find((r) => r.status === "rejected")
    if (failed) toast.error((failed.reason as Error).message)
  }

  const showMatches = term.length >= 2 && (matches.data?.items.length ?? 0) > 0

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setSearch("")
      }}
      title="Command palette"
      className="sm:max-w-lg"
      description="Go to a page, start an action or find a transaction"
    >
      <Command>
        <CommandInput
          placeholder="Search pages, actions and transactions"
          value={search}
          onValueChange={setSearch}
        />
        <CommandList className="max-h-96 [&_[data-slot=command-item]>svg:last-child]:hidden">
          <CommandEmpty>No results</CommandEmpty>
          <CommandGroup heading="Go to">
            <CommandItem onSelect={() => go(to("/"))}>Overview</CommandItem>
            <CommandItem onSelect={() => go(to("/transactions"))}>
              Transactions
            </CommandItem>
            <CommandItem onSelect={() => go(to("/budget"))}>Budget</CommandItem>
            <CommandItem onSelect={() => go(to("/accounts"))}>
              Accounts
            </CommandItem>
            <CommandItem onSelect={() => go(to("/reports"))}>
              Reports
            </CommandItem>
            <CommandItem onSelect={() => go(to("/activity"))}>
              Activity
            </CommandItem>
            <CommandItem onSelect={() => go(to("/settings"))}>
              Settings
            </CommandItem>
            {[thisMonth, lastMonth].map((m) => (
              <CommandItem key={m} onSelect={() => go(to(`/budget/${m}`))}>
                Budget: {formatMonth(m)}
              </CommandItem>
            ))}
            {accounts.map((a) => (
              <CommandItem
                key={a.id}
                value={`account ${a.name} ${a.id}`}
                onSelect={() => go(to(`/accounts/${a.id}`))}
              >
                {a.name}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Actions">
            <CommandItem
              onSelect={() => go(command("/transactions", "new-transaction"))}
            >
              New transaction
            </CommandItem>
            <CommandItem
              onSelect={() => go(command("/transactions", "import-csv"))}
            >
              Import CSV
            </CommandItem>
            <CommandItem
              onSelect={() =>
                go(() =>
                  navigate({ to: "/accounts", search: { add: "choose" } })
                )
              }
            >
              Add account
            </CommandItem>
            {connections.length > 0 && (
              <CommandItem onSelect={() => go(syncAll)}>Sync now</CommandItem>
            )}
            <CommandItem
              onSelect={() =>
                go(() =>
                  setTheme(
                    document.documentElement.classList.contains("dark")
                      ? "light"
                      : "dark"
                  )
                )
              }
              keywords={["dark", "light", "mode", theme]}
            >
              Toggle theme
            </CommandItem>
          </CommandGroup>
          {showMatches && (
            <CommandGroup heading="Transactions">
              {matches.data!.items.map((t) => (
                <CommandItem
                  key={t.id}
                  // Always matches what was typed: the server already searched.
                  value={`${search} transaction ${t.id}`}
                  onSelect={() => go(to("/transactions", { search: term }))}
                >
                  <span className="w-16 shrink-0 text-muted-foreground tabular-nums">
                    {formatDate(t.date)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {t.transferAccountName
                      ? `→ ${t.transferAccountName}`
                      : (t.payeeName ?? t.importedPayee ?? "No payee")}
                    {t.notes && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {t.notes}
                      </span>
                    )}
                  </span>
                  <Money
                    cents={t.amount}
                    currency={
                      allAccounts?.find((a) => a.id === t.accountId)
                        ?.currency ?? "EUR"
                    }
                    signed
                    className="ml-auto"
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
