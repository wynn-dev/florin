import { useState } from "react"
import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronsUpDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { queries } from "@/lib/api"
import { Button } from "@/components/ui/button"
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

/** What a category picker can pick. */
export type CategoryChoice =
  | { type: "category"; id: number }
  /** A transfer to (or from) this account. */
  | { type: "transfer"; accountId: number }
  /** Move money's source or target. */
  | { type: "ready-to-assign" }

type ListOptions = {
  /** Category ids to list first under "Recent"; defaults to the person's last picks. */
  recent?: number[]
  /** Adds a last "Transfer" group listing open accounts, except this one. */
  transfers?: boolean | { excludeAccountId?: number }
  /** Adds "Ready to assign" as the first option. */
  readyToAssign?: boolean
  /** Lists hidden categories too. */
  includeHidden?: boolean
  /** Category ids to leave out, e.g. the one money moves from. */
  exclude?: number[]
  /** Something to show at the right of an option, e.g. a category's available money. */
  trailing?: (choice: CategoryChoice) => ReactNode
  /** Focuses the search field when the list mounts. */
  autoFocus?: boolean
}

const RECENT_KEY = "florin-recent-categories"

function readRecent(): number[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "number") : []
  } catch {
    return []
  }
}

function remember(id: number) {
  try {
    const ids = [id, ...readRecent().filter((other) => other !== id)]
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, 5)))
  } catch {
    // Private mode or storage full: recent picks are a nicety.
  }
}

function sameChoice(a: CategoryChoice | null, b: CategoryChoice): boolean {
  if (!a || a.type !== b.type) return false
  if (a.type === "category" && b.type === "category") return a.id === b.id
  if (a.type === "transfer" && b.type === "transfer")
    return a.accountId === b.accountId
  return true
}

/**
 * The searchable list behind the picker, for hosting it yourself (in a
 * Drawer on a phone). Search on top, Recent first, then each group, then
 * Transfer.
 */
export function CategoryList({
  value,
  onSelect,
  recent,
  transfers,
  readyToAssign,
  includeHidden,
  exclude = [],
  trailing,
  autoFocus,
}: ListOptions & {
  value: CategoryChoice | null
  onSelect: (choice: CategoryChoice) => void
}) {
  const [search, setSearch] = useState("")
  const groups = useQuery(queries.categories()).data ?? []
  const accounts = useQuery({
    ...queries.accounts(),
    enabled: !!transfers,
  }).data
  const [recentIds] = useState(() => recent ?? readRecent())

  const visible = groups
    .map((group) => ({
      ...group,
      categories: group.categories.filter(
        (c) => (includeHidden || !c.hidden) && !exclude.includes(c.id)
      ),
    }))
    .filter((group) => group.categories.length > 0)
  const byId = new Map(
    visible.flatMap((g) =>
      g.categories.map((c) => [c.id, { ...c, group: g.name }])
    )
  )
  const recentCategories = recentIds.flatMap((id) => byId.get(id) ?? [])
  const excludeAccountId =
    typeof transfers === "object" ? transfers.excludeAccountId : undefined
  const transferAccounts = transfers
    ? (accounts ?? []).filter((a) => !a.closed && a.id !== excludeAccountId)
    : []

  const pick = (choice: CategoryChoice) => {
    if (choice.type === "category") remember(choice.id)
    onSelect(choice)
  }

  const item = (
    key: string,
    label: string,
    choice: CategoryChoice,
    keywords: string[] = []
  ) => (
    <CommandItem
      key={key}
      value={key}
      keywords={[label, ...keywords]}
      data-checked={sameChoice(value, choice)}
      onSelect={() => pick(choice)}
      // With a trailing figure, the figure takes the check mark's place.
      className={trailing ? "[&>svg:last-child]:hidden" : undefined}
    >
      <span className="truncate">{label}</span>
      {trailing && (
        <span className="ml-auto pl-3 text-muted-foreground tabular-nums">
          {trailing(choice)}
        </span>
      )}
    </CommandItem>
  )

  return (
    <Command
      filter={(_, query, keywords = []) =>
        keywords.join(" ").toLowerCase().includes(query.trim().toLowerCase())
          ? 1
          : 0
      }
    >
      <CommandInput
        autoFocus={autoFocus}
        placeholder="Search categories"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No category matches.</CommandEmpty>
        {readyToAssign && (
          <CommandGroup>
            {item("ready", "Ready to assign", { type: "ready-to-assign" })}
          </CommandGroup>
        )}
        {search === "" && recentCategories.length > 0 && (
          <CommandGroup heading="Recent">
            {recentCategories.map((c) =>
              item(`recent-${c.id}`, c.name, { type: "category", id: c.id })
            )}
          </CommandGroup>
        )}
        {visible.map((group) => (
          <CommandGroup key={group.id} heading={group.name}>
            {group.categories.map((c) =>
              item(`category-${c.id}`, c.name, { type: "category", id: c.id }, [
                group.name,
              ])
            )}
          </CommandGroup>
        ))}
        {transferAccounts.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Transfer">
              {transferAccounts.map((a) =>
                item(
                  `account-${a.id}`,
                  a.name,
                  { type: "transfer", accountId: a.id },
                  ["transfer"]
                )
              )}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  )
}

/** The text a choice reads as: the category's name, "→ Savings" for a transfer. */
export function useCategoryLabel(choice: CategoryChoice | null): string | null {
  const groups = useQuery(queries.categories()).data
  const accounts = useQuery({
    ...queries.accounts(),
    enabled: choice?.type === "transfer",
  }).data
  if (!choice) return null
  if (choice.type === "ready-to-assign") return "Ready to assign"
  if (choice.type === "transfer") {
    const account = accounts?.find((a) => a.id === choice.accountId)
    return account ? `→ ${account.name}` : null
  }
  for (const group of groups ?? []) {
    const category = group.categories.find((c) => c.id === choice.id)
    if (category) return category.name
  }
  return null
}

/**
 * Picks a category: Popover + Command with search, Recent first, then groups,
 * and optionally a Transfer group of accounts and "Ready to assign". The
 * "field" look is a form control; "inline" reads as plain text in a table
 * cell, muted "Categorise" when empty. It loads categories (and accounts for
 * transfers) itself.
 */
export function CategoryPicker({
  value,
  onChange,
  variant = "field",
  placeholder = variant === "inline" ? "Categorise" : "Category",
  id,
  disabled,
  className,
  ...options
}: ListOptions & {
  value: CategoryChoice | null
  onChange: (choice: CategoryChoice) => void
  variant?: "field" | "inline"
  placeholder?: string
  id?: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const label = useCategoryLabel(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === "field" ? (
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn("h-9 w-full justify-between font-normal", className)}
          >
            <span className={cn("truncate", !label && "text-muted-foreground")}>
              {label ?? placeholder}
            </span>
            <ChevronsUpDownIcon className="text-muted-foreground" />
          </Button>
        ) : (
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "-mx-2 flex h-7 max-w-full items-center rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted",
              !label && "text-muted-foreground",
              className
            )}
          >
            <span className="truncate">{label ?? placeholder}</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
      >
        <CategoryList
          value={value}
          onSelect={(choice) => {
            onChange(choice)
            setOpen(false)
          }}
          {...options}
        />
      </PopoverContent>
    </Popover>
  )
}
