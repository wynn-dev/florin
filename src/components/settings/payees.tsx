import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { SearchIcon, Trash2Icon, XIcon } from "lucide-react"
import { toast } from "sonner"
import type { Payee } from "@/shared/types"
import { CategoryPicker } from "@/components/category-picker"
import { capitalise } from "@/components/settings/mcp"
import { EmptyState, QueryState, SkeletonRows } from "@/components/states"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, queries } from "@/lib/api"
import { cn } from "@/lib/utils"

const LIMIT = 500

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export function PayeesSettings() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const term = useDebounced(search.trim(), 150)
  const options = { search: term || undefined, limit: LIMIT }
  const payees = useQuery({
    ...queries.payees(options),
    placeholderData: (previous) => previous,
  })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [merging, setMerging] = useState(false)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["payees"] })
  const patch = useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number
      name?: string
      defaultCategoryId?: number | null
    }) => api<Payee>(`/payees/${id}`, { method: "PATCH", body }),
    onMutate: ({ id, ...body }) => {
      queryClient.setQueriesData<{ items: Payee[]; total: number }>(
        { queryKey: ["payees"] },
        (page) =>
          page && {
            ...page,
            items: page.items.map((p) => (p.id === id ? { ...p, ...body } : p)),
          }
      )
    },
    onError: (error, variables) => {
      void invalidate()
      toast.error(capitalise(error.message), {
        action: { label: "Retry", onClick: () => patch.mutate(variables) },
      })
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: (payee: Payee) =>
      api(`/payees/${payee.id}`, { method: "DELETE" }),
    onSuccess: (_, payee) => {
      toast(`Deleted ${payee.name}`, {
        action: {
          label: "Undo",
          onClick: async () => {
            const restored = await api<Payee>("/payees", {
              method: "POST",
              body: { name: payee.name },
            })
            if (payee.defaultCategoryId !== null)
              await api(`/payees/${restored.id}`, {
                method: "PATCH",
                body: { defaultCategoryId: payee.defaultCategoryId },
              })
            await invalidate()
          },
        },
      })
    },
    onError: (error) => toast.error(capitalise(error.message)),
    onSettled: invalidate,
  })

  const items = payees.data?.items ?? []
  const chosen = items.filter((p) => selected.has(p.id))
  const toggle = (id: number, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <div className="flex flex-col gap-4">
      <InputGroup className="w-full sm:w-64">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          placeholder="Search payees"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </InputGroup>
      <QueryState
        query={payees}
        skeleton={<SkeletonRows rows={8} />}
        error="Couldn't load payees."
      >
        {(page) =>
          page.items.length === 0 ? (
            term ? (
              <EmptyState title="No payees match">
                <Button variant="outline" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              </EmptyState>
            ) : (
              <EmptyState title="No payees yet" />
            )
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent [&>th]:h-9 [&>th]:text-xs [&>th]:font-medium [&>th]:text-muted-foreground">
                    <TableHead className="hidden w-8 pl-1 md:table-cell">
                      <span className="sr-only">Select</span>
                    </TableHead>
                    <TableHead className="pl-0 md:pl-2">Name</TableHead>
                    <TableHead className="w-32 md:w-48">
                      Default category
                    </TableHead>
                    <TableHead className="w-24 text-right md:w-28">
                      Transactions
                    </TableHead>
                    <TableHead className="hidden w-9 md:table-cell">
                      <span className="sr-only">Delete</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.items.map((p) => (
                    <PayeeRow
                      key={p.id}
                      payee={p}
                      selected={selected.has(p.id)}
                      anySelected={selected.size > 0}
                      onSelect={(on) => toggle(p.id, on)}
                      onRename={(name) => patch.mutate({ id: p.id, name })}
                      onCategory={(defaultCategoryId) =>
                        patch.mutate({ id: p.id, defaultCategoryId })
                      }
                      onDelete={() => remove.mutate(p)}
                    />
                  ))}
                </TableBody>
              </Table>
              {page.total > page.items.length && (
                <p className="text-sm text-muted-foreground">
                  Showing {page.items.length} of {page.total}. Search to find
                  the rest.
                </p>
              )}
            </>
          )
        }
      </QueryState>
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4 md:bottom-6">
          <div className="flex h-11 items-center gap-1 rounded-xl border bg-popover pr-1.5 pl-4 text-sm shadow-lg">
            <span className="mr-2 tabular-nums">{selected.size} selected</span>
            {selected.size >= 2 && (
              <Button size="sm" onClick={() => setMerging(true)}>
                Merge into…
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
            >
              <XIcon />
            </Button>
          </div>
        </div>
      )}
      <MergeDialog
        open={merging}
        onOpenChange={setMerging}
        payees={chosen}
        onMerged={() => {
          setSelected(new Set())
          void invalidate()
        }}
      />
    </div>
  )
}

function PayeeRow({
  payee,
  selected,
  anySelected,
  onSelect,
  onRename,
  onCategory,
  onDelete,
}: {
  payee: Payee
  selected: boolean
  anySelected: boolean
  onSelect: (on: boolean) => void
  onRename: (name: string) => void
  onCategory: (id: number | null) => void
  onDelete: () => void
}) {
  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      className="group h-10"
    >
      <TableCell className="hidden pl-1 md:table-cell">
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onSelect(v === true)}
          aria-label={`Select ${payee.name}`}
          className={cn(
            "transition-opacity",
            !anySelected &&
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          )}
        />
      </TableCell>
      <TableCell className="max-w-0 py-0 pl-0 md:pl-2">
        <NameCell name={payee.name} onRename={onRename} />
      </TableCell>
      <TableCell className="py-0">
        <div className="flex items-center gap-0.5">
          <CategoryPicker
            variant="inline"
            placeholder="None"
            value={
              payee.defaultCategoryId === null
                ? null
                : { type: "category", id: payee.defaultCategoryId }
            }
            onChange={(choice) => {
              if (choice.type === "category") onCategory(choice.id)
            }}
            className="max-w-28 md:max-w-40"
          />
          {payee.defaultCategoryId !== null && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => onCategory(null)}
              aria-label="Clear default category"
            >
              <XIcon />
            </Button>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {payee.transactionCount ? (
          <Link
            to="/transactions"
            search={{ payeeId: payee.id }}
            className="underline-offset-4 hover:underline"
          >
            {payee.transactionCount.toLocaleString()}
          </Link>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </TableCell>
      <TableCell className="hidden py-0 pr-1 md:table-cell">
        {payee.transactionCount === 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={onDelete}
            aria-label={`Delete ${payee.name}`}
          >
            <Trash2Icon />
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

/** The name, renamed in place: click, type, Enter (Esc cancels). */
function NameCell({
  name,
  onRename,
}: {
  name: string
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])
  const save = () => {
    setEditing(false)
    if (value.trim() && value.trim() !== name) onRename(value.trim())
    else setValue(name)
  }
  if (editing)
    return (
      <Input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save()
          if (e.key === "Escape") {
            setValue(name)
            setEditing(false)
          }
        }}
        className="-ml-2 h-8 px-2"
        aria-label="Payee name"
      />
    )
  return (
    <button
      type="button"
      className="-ml-2 block h-8 max-w-full truncate rounded-md px-2 text-left hover:bg-muted"
      onClick={() => {
        setValue(name)
        setEditing(true)
      }}
    >
      {name}
    </button>
  )
}

function MergeDialog({
  open,
  onOpenChange,
  payees,
  onMerged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  payees: Payee[]
  onMerged: () => void
}) {
  // Keep the payee with the most transactions unless the person picks another.
  const busiest = [...payees].sort(
    (a, b) => b.transactionCount - a.transactionCount
  )[0] as Payee | undefined
  const [intoId, setIntoId] = useState<number | null>(null)
  const into = payees.find((p) => p.id === intoId) ?? busiest
  const others = payees.filter((p) => p.id !== into?.id)
  const moving = others.reduce((n, p) => n + p.transactionCount, 0)
  const merge = useMutation({
    mutationFn: () =>
      api<Payee>(`/payees/${into!.id}/merge`, {
        method: "POST",
        body: { ids: others.map((p) => p.id) },
      }),
    onSuccess: onMerged,
    onError: (error) => toast.error(capitalise(error.message)),
  })
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setIntoId(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Merge {payees.length} payees into…
          </AlertDialogTitle>
          <AlertDialogDescription>
            {into &&
              `${moving.toLocaleString()} ${moving === 1 ? "transaction moves" : "transactions move"} to ${into.name}. The other ${others.length === 1 ? "payee is" : "payees are"} deleted.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div
          role="radiogroup"
          className="flex max-h-64 flex-col overflow-y-auto rounded-lg border"
        >
          {payees.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === into?.id}
              onClick={() => setIntoId(p.id)}
              className={cn(
                "flex h-10 items-center gap-3 px-3 text-left text-sm not-last:border-b hover:bg-muted/50",
                p.id === into?.id && "bg-muted font-medium hover:bg-muted"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border",
                  p.id === into?.id && "border-primary"
                )}
              >
                {p.id === into?.id && (
                  <span className="size-2 rounded-full bg-primary" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {p.transactionCount.toLocaleString()}
              </span>
            </button>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!into || merge.isPending}
            onClick={() => merge.mutate()}
          >
            Merge
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
