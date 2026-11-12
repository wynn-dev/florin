import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronDownIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { api, queries } from "@/lib/api"
import { formatDayTime, today } from "@/lib/format"
import { sourceName } from "@/components/source-label"
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
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Toggle } from "@/components/ui/toggle"
import { dateLabel, datePresets, hasFilters } from "./search"
import { transactionQueries } from "./queries"
import type { ReactNode } from "react"
import type { DateRange } from "react-day-picker"
import type { ActivityEntry } from "@/shared/activity"
import type { TransactionSearch } from "./search"

/**
 * The filter row: search, account (unless the table is one account's),
 * date, categories, "Uncategorised · 14", the "Changed by …" chip from
 * Activity, and Clear.
 */
export function TransactionFilters({
  search,
  onChange,
  accountId,
}: {
  search: TransactionSearch
  onChange: (next: TransactionSearch) => void
  /** Set when the table is one account's register: no Account filter. */
  accountId?: number
}) {
  const set = (patch: Partial<TransactionSearch>) =>
    onChange({ ...search, ...patch })
  const uncategorized = useQuery(
    transactionQueries.uncategorized(accountId ?? search.accountId)
  )
  const count = uncategorized.data ?? 0

  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <SearchField
        value={search.search ?? ""}
        onChange={(value) => set({ search: value || undefined })}
      />
      {/* On a phone the filters scroll sideways in one line. */}
      <div className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 *:shrink-0 md:contents">
        {accountId === undefined && (
          <AccountFilter
            value={search.accountId}
            onChange={(id) => set({ accountId: id })}
          />
        )}
        <DateFilter
          from={search.from}
          to={search.to}
          onChange={(from, to) => set({ from, to })}
        />
        <CategoryFilter
          value={search.categoryIds ?? []}
          onChange={(ids) => set({ categoryIds: ids.length ? ids : undefined })}
        />
        {(count > 0 || search.uncategorized) && (
          <Toggle
            variant="outline"
            pressed={!!search.uncategorized}
            onPressedChange={(on) => set({ uncategorized: on || undefined })}
            className="h-8 px-3 font-normal data-[state=on]:border-foreground/30"
          >
            Uncategorised
            <span className="text-muted-foreground tabular-nums">
              · {count}
            </span>
          </Toggle>
        )}
        {search.payeeId !== undefined && (
          <PayeeChip
            id={search.payeeId}
            onRemove={() => set({ payeeId: undefined })}
          />
        )}
        {search.change !== undefined && (
          <ChangeChip
            id={search.change}
            onRemove={() => set({ change: undefined })}
          />
        )}
        {hasFilters(search, accountId !== undefined) && (
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() =>
              onChange(
                accountId === undefined ? {} : { accountId: search.accountId }
              )
            }
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}

/** Types freely; the filter follows 250 ms after the last key. */
function SearchField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [text, setText] = useState(value)
  const [sent, setSent] = useState(value)
  // A value from outside (Clear, back button) replaces what's typed.
  if (value !== sent) {
    setSent(value)
    setText(value)
  }
  useEffect(() => {
    if (text === sent) return
    const timer = setTimeout(() => {
      setSent(text)
      onChange(text)
    }, 250)
    return () => clearTimeout(timer)
  }, [text, sent, onChange])

  return (
    <InputGroup className="h-8 w-full md:w-60">
      <InputGroupInput
        type="search"
        placeholder="Search"
        aria-label="Search transactions"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault()
            setText("")
          }
        }}
        className="[&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label="Clear search"
            onClick={() => setText("")}
          >
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}

export function FilterButton({
  label,
  shown,
  open,
  ...props
}: {
  label: string
  /** What's picked, or null for nothing (the label shows, muted). */
  shown: ReactNode | null
  open: boolean
} & React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      aria-expanded={open}
      className={cn(
        "max-w-56 gap-1.5 font-normal",
        shown === null && "text-muted-foreground"
      )}
      {...props}
    >
      <span className="truncate">{shown ?? label}</span>
      <ChevronDownIcon className="text-muted-foreground" />
    </Button>
  )
}

function AccountFilter({
  value,
  onChange,
}: {
  value: number | undefined
  onChange: (id: number | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const accounts = useQuery(queries.accounts()).data ?? []
  const current = accounts.find((a) => a.id === value)
  const pick = (id: number | undefined) => {
    onChange(id)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterButton
          label="Account"
          shown={current?.name ?? null}
          open={open}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0">
        <Command>
          <CommandInput placeholder="Search accounts" />
          <CommandList>
            <CommandEmpty>No account matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="All accounts"
                data-checked={value === undefined}
                onSelect={() => pick(undefined)}
              >
                All accounts
              </CommandItem>
              {accounts
                .filter((a) => !a.closed || a.id === value)
                .map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`${a.name} ${a.id}`}
                    data-checked={a.id === value}
                    onSelect={() => pick(a.id)}
                  >
                    <span className="truncate">{a.name}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function isoOf(date: Date): string {
  return today(date)
}

export function DateFilter({
  from,
  to,
  onChange,
}: {
  from?: string
  to?: string
  onChange: (from?: string, to?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const [range, setRange] = useState<DateRange | undefined>()
  const presets = datePresets()
  const label = dateLabel(from, to)
  const isPreset = presets.some((p) => p.from === from && p.to === to)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setCustom(!!(from || to) && !isPreset)
          setRange(
            from || to
              ? {
                  from: from ? new Date(`${from}T00:00:00`) : undefined,
                  to: to ? new Date(`${to}T00:00:00`) : undefined,
                }
              : undefined
          )
        }
      }}
    >
      <PopoverTrigger asChild>
        <FilterButton label="Date" shown={label} open={open} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-1">
        {custom ? (
          <div className="flex flex-col">
            <Calendar
              mode="range"
              numberOfMonths={1}
              selected={range}
              onSelect={setRange}
              defaultMonth={range?.from}
              weekStartsOn={1}
            />
            <div className="flex items-center justify-end gap-2 border-t p-2">
              <Button variant="ghost" onClick={() => setCustom(false)}>
                Back
              </Button>
              <Button
                disabled={!range?.from}
                onClick={() => {
                  onChange(
                    isoOf(range!.from!),
                    isoOf(range!.to ?? range!.from!)
                  )
                  setOpen(false)
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        ) : (
          <Command className="w-48">
            <CommandList>
              <CommandGroup>
                {presets.map((p) => (
                  <CommandItem
                    key={p.label}
                    value={p.label}
                    data-checked={
                      p.from === from && p.to === to && (!!from || !!to)
                    }
                    onSelect={() => {
                      onChange(p.from, p.to)
                      setOpen(false)
                    }}
                  >
                    {p.label}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="Custom"
                  data-checked={!!(from || to) && !isPreset}
                  onSelect={() => setCustom(true)}
                >
                  Custom…
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}

function CategoryFilter({
  value,
  onChange,
}: {
  value: number[]
  onChange: (ids: number[]) => void
}) {
  const [open, setOpen] = useState(false)
  const groups = useQuery(queries.categories()).data ?? []
  const all = groups.flatMap((g) => g.categories)
  const names = value.flatMap((id) => all.find((c) => c.id === id)?.name ?? [])
  const label =
    names.length === 0
      ? null
      : names.length === 1
        ? names[0]
        : `${names.length} categories`
  const toggle = (id: number) =>
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
    )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterButton label="Category" shown={label} open={open} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Search categories" />
          <CommandList>
            <CommandEmpty>No category matches.</CommandEmpty>
            {groups.map((group) => {
              const visible = group.categories.filter(
                (c) => !c.hidden || value.includes(c.id)
              )
              if (!visible.length) return null
              return (
                <CommandGroup key={group.id} heading={group.name}>
                  {visible.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`${c.name} ${c.id}`}
                      keywords={[group.name]}
                      data-checked={value.includes(c.id)}
                      onSelect={() => toggle(c.id)}
                    >
                      <span className="truncate">{c.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>
          {value.length > 0 && (
            <div className="border-t p-1">
              <Button
                variant="ghost"
                className="w-full justify-center text-muted-foreground"
                onClick={() => onChange([])}
              >
                Clear categories
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** "Changed by Claude Desktop · 12 Nov 09:30", from an Activity entry; removable. */
function ChangeChip({ id, onRemove }: { id: number; onRemove: () => void }) {
  const entry = useQuery({
    queryKey: ["activity", "entry", id],
    queryFn: () => api<ActivityEntry>(`/activity/${id}`),
    staleTime: Infinity,
  }).data
  return (
    <Chip onRemove={onRemove}>
      {entry
        ? `Changed by ${sourceName(entry.actor)} · ${formatDayTime(entry.at)}`
        : "Changed in one Activity entry"}
    </Chip>
  )
}

/** "Payee · Bol.com", from Settings › Payees; removable. */
function PayeeChip({ id, onRemove }: { id: number; onRemove: () => void }) {
  const name = useQuery(transactionQueries.lastForPayee(id)).data?.payeeName
  return <Chip onRemove={onRemove}>Payee · {name ?? "…"}</Chip>
}

function Chip({
  children,
  onRemove,
}: {
  children: ReactNode
  onRemove: () => void
}) {
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-md bg-muted pr-1 pl-3 text-sm">
      <span className="truncate">{children}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Remove filter"
        onClick={onRemove}
        className="text-muted-foreground hover:bg-background"
      >
        <XIcon />
      </Button>
    </span>
  )
}
