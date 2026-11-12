import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { ChevronsUpDownIcon, PlusIcon } from "lucide-react"
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
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

/** A picked payee: an existing one by id, or a new name (id null) to create on save. */
export type PayeeChoice = { id: number | null; name: string }

/**
 * Picks a payee: a combobox that searches payees on the server and offers
 * "Create 'Bakery Rossi'" when the name is new. A new payee is only a name
 * until the transaction is saved: NewTransaction's payeeName creates it.
 */
export function PayeePicker({
  value,
  onChange,
  placeholder = "Payee",
  id,
  disabled,
  className,
}: {
  value: PayeeChoice | null
  onChange: (choice: PayeeChoice) => void
  placeholder?: string
  id?: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const term = search.trim()
  const payees = useQuery({
    ...queries.payees({ search: term, limit: 50 }),
    enabled: open,
    placeholderData: keepPreviousData,
  }).data?.items
  const exact = payees?.some((p) => p.name.toLowerCase() === term.toLowerCase())

  const pick = (choice: PayeeChoice) => {
    onChange(choice)
    setOpen(false)
    setSearch("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-9 w-full justify-between font-normal", className)}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value?.name ?? placeholder}
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or add a payee"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {term === "" && <CommandEmpty>No payees yet.</CommandEmpty>}
            {payees && payees.length > 0 && (
              <CommandGroup>
                {payees.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`payee-${p.id}`}
                    data-checked={value?.id === p.id}
                    onSelect={() => pick({ id: p.id, name: p.name })}
                  >
                    <span className="truncate">{p.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {term !== "" && !exact && (
              <CommandGroup>
                <CommandItem
                  value="create"
                  onSelect={() => pick({ id: null, name: term })}
                >
                  <PlusIcon />
                  <span className="truncate">Create &lsquo;{term}&rsquo;</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
