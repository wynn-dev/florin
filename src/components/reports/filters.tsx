import { useQuery } from "@tanstack/react-query"
import { ChevronDownIcon } from "lucide-react"
import { useState } from "react"
import { RANGES } from "./search"
import type { RangeId, ReportSearch } from "./search"
import type { Account } from "@/shared/types"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { queries } from "@/lib/api"
import { addMonths, currentMonth, formatDate, today } from "@/lib/format"

/** The one filter row the four reports share: range, then accounts. */
export function ReportFilters({
  search,
  onChange,
  onBudgetOnly,
}: {
  search: ReportSearch
  onChange: (next: Partial<ReportSearch>) => void
  /** The report covers on-budget accounts only, so only those are offered. */
  onBudgetOnly: boolean
}) {
  const [customOpen, setCustomOpen] = useState(false)
  const range = search.range ?? "12m"
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={range}
        onValueChange={(value: RangeId) => {
          if (value === "custom") {
            onChange({ range: "custom", from: search.from, to: search.to })
            setCustomOpen(true)
          } else onChange({ range: value, from: undefined, to: undefined })
        }}
      >
        <SelectTrigger className="min-w-40" aria-label="Range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGES.filter((r) => r.id !== "custom").map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.label}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value="custom">Custom…</SelectItem>
        </SelectContent>
      </Select>
      {range === "custom" && (
        <CustomRange
          open={customOpen}
          onOpenChange={setCustomOpen}
          from={search.from}
          to={search.to}
          onChange={(from, to) => onChange({ range: "custom", from, to })}
        />
      )}
      <AccountsFilter
        selected={search.accounts ?? []}
        onBudgetOnly={onBudgetOnly}
        onChange={(accounts) =>
          onChange({ accounts: accounts.length ? accounts : undefined })
        }
      />
    </div>
  )
}

function CustomRange({
  open,
  onOpenChange,
  from,
  to,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  from?: string
  to?: string
  onChange: (from: string, to: string) => void
}) {
  const asDate = (iso?: string) =>
    iso ? new Date(`${iso}T00:00:00`) : undefined
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  const [draft, setDraft] = useState<{ from?: Date; to?: Date } | undefined>(
    from ? { from: asDate(from), to: asDate(to) } : undefined
  )
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="font-normal tabular-nums">
          {from && to
            ? `${formatDate(from)} – ${formatDate(to)}`
            : "Pick dates"}
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          numberOfMonths={2}
          defaultMonth={
            draft?.from ?? asDate(`${addMonths(currentMonth(), -1)}-01`)
          }
          selected={draft as never}
          disabled={{ after: asDate(today())! }}
          onSelect={(next: { from?: Date; to?: Date } | undefined) => {
            setDraft(next)
            if (next?.from && next.to && next.to > next.from) {
              onChange(iso(next.from), iso(next.to))
              onOpenChange(false)
            }
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function AccountsFilter({
  selected,
  onBudgetOnly,
  onChange,
}: {
  selected: number[]
  onBudgetOnly: boolean
  onChange: (ids: number[]) => void
}) {
  const accounts = useQuery(queries.accounts()).data ?? []
  const offered = accounts.filter(
    (a) =>
      (!a.closed || selected.includes(a.id)) && (!onBudgetOnly || a.onBudget)
  )
  const picked = offered.filter((a) => selected.includes(a.id))
  const label = labelFor(picked)
  const toggle = (account: Account) =>
    onChange(
      selected.includes(account.id)
        ? selected.filter((id) => id !== account.id)
        : [...selected, account.id]
    )
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="max-w-64 font-normal">
          <span className="truncate">{label}</span>
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          {offered.length > 7 && <CommandInput placeholder="Find an account" />}
          <CommandList>
            <CommandEmpty>No account matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                data-checked={picked.length === 0}
                onSelect={() => onChange([])}
              >
                All accounts
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              {offered.map((account) => (
                <CommandItem
                  key={account.id}
                  value={`${account.name} ${account.id}`}
                  data-checked={selected.includes(account.id)}
                  onSelect={() => toggle(account)}
                >
                  <span className="truncate">{account.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function labelFor(picked: Account[]): string {
  if (!picked.length) return "All accounts"
  if (picked.length === 1) return picked[0].name
  return `${picked.length} accounts`
}
