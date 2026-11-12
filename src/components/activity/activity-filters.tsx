import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { sourceName } from "@/components/source-label"
import { DateFilter, FilterButton } from "@/components/transactions/filters"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ACTIVITY_KINDS } from "@/shared/activity"
import { activityQueries } from "./queries"
import type { ActivitySearch } from "./queries"
import type { ActivityKind } from "@/shared/activity"
import type { Actor } from "@/shared/types"

const KIND_LABELS: Record<ActivityKind, string> = {
  transactions: "Transactions",
  budget: "Budget",
  accounts: "Accounts",
  categories: "Categories",
  settings: "Settings",
}

/**
 * The Source choices: You first, then each MCP client, each bank's sync,
 * IBKR, and every imported file together as "Import".
 */
function sourceOptions(actors: Actor[]): { value: string; label: string }[] {
  const order = (a: string) =>
    a === "person"
      ? 0
      : a.startsWith("mcp:")
        ? 1
        : a.startsWith("bank-sync")
          ? 2
          : a === "ibkr"
            ? 3
            : a.startsWith("import")
              ? 4
              : 5
  const options = new Map<string, string>()
  for (const actor of [...actors].sort(
    (a, b) => order(a) - order(b) || a.localeCompare(b)
  )) {
    if (actor.startsWith("import:")) options.set("import:", "Import")
    else options.set(actor, sourceName(actor))
  }
  return [...options].map(([value, label]) => ({ value, label }))
}

export function ActivityFilters({
  search,
  onChange,
}: {
  search: ActivitySearch
  onChange: (next: ActivitySearch) => void
}) {
  const set = (patch: Partial<ActivitySearch>) =>
    onChange({ ...search, ...patch })
  const sources = sourceOptions(useQuery(activityQueries.sources()).data ?? [])
  const any = Object.values(search).some((v) => v !== undefined)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Choice
        label="Source"
        value={search.source}
        options={sources}
        onChange={(source) => set({ source })}
      />
      <Choice
        label="Kind"
        value={search.kind}
        options={ACTIVITY_KINDS.map((k) => ({
          value: k,
          label: KIND_LABELS[k],
        }))}
        onChange={(kind) => set({ kind: kind as ActivityKind | undefined })}
      />
      <DateFilter
        from={search.from}
        to={search.to}
        onChange={(from, to) => set({ from, to })}
      />
      {any && (
        <Button
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => onChange({})}
        >
          Clear
        </Button>
      )}
    </div>
  )
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string | undefined
  options: { value: string; label: string }[]
  onChange: (value: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const current =
    options.find((o) => o.value === value)?.label ??
    (value ? sourceName(value as Actor) : null)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterButton label={label} shown={current} open={open} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem
                value={`All ${label}`}
                data-checked={value === undefined}
                onSelect={() => {
                  onChange(undefined)
                  setOpen(false)
                }}
              >
                {label === "Source" ? "All sources" : "All kinds"}
              </CommandItem>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  keywords={[o.label]}
                  data-checked={o.value === value}
                  onSelect={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
