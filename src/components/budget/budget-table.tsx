import { useState } from "react"
import { ChevronDownIcon, PlusIcon } from "lucide-react"
import { AssignedCell, AvailablePill, InlineInput, SpentLink } from "./cells"
import {
  CategoryMenu,
  GroupMenu,
  useCategoryActions,
  useDelete,
} from "./manage"
import type { BudgetMonth } from "@/shared/types"
import { cn } from "@/lib/utils"
import { formatMoney } from "@/lib/format"
import { Button } from "@/components/ui/button"

const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_8.5rem] items-center gap-x-4 px-2"

/**
 * The month's envelopes: groups (collapsible, with totals) and their
 * categories, headed Category · Assigned · Spent · Available. Clicking a row
 * selects it for the inspector.
 */
export function BudgetTable({
  month,
  currency,
  showHidden,
  selectedId,
  onSelect,
}: {
  month: BudgetMonth
  currency: string
  showHidden: boolean
  selectedId: number | null
  onSelect: (id: number | null) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [addingTo, setAddingTo] = useState<number | null>(null)
  const actions = useCategoryActions()
  const del = useDelete()

  const toggle = (id: number) => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCollapsed(next)
  }

  return (
    <div role="table" aria-label="Budget" className="text-sm">
      <div
        role="row"
        className={cn(
          COLUMNS,
          "sticky top-0 z-10 h-9 border-b bg-background text-xs font-medium text-muted-foreground"
        )}
      >
        <span role="columnheader" className="pl-6">
          Category
        </span>
        <span role="columnheader" className="text-right">
          Assigned
        </span>
        <span role="columnheader" className="text-right">
          Spent
        </span>
        <span role="columnheader" className="pr-2 text-right">
          Available
        </span>
      </div>

      {month.groups.map((group) => {
        const open = !collapsed.has(group.id)
        const categories = group.categories.filter(
          (c) => showHidden || !c.hidden
        )
        return (
          <div key={group.id} role="rowgroup">
            <div
              role="row"
              className={cn(
                COLUMNS,
                "group/row h-10 border-b bg-muted/40 font-semibold"
              )}
            >
              <span role="rowheader" className="flex min-w-0 items-center">
                <button
                  type="button"
                  onClick={() => toggle(group.id)}
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${group.name}`}
                  className="-ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <ChevronDownIcon
                    className={cn(
                      "size-4 transition-transform",
                      !open && "-rotate-90"
                    )}
                  />
                </button>
                {renaming === `g${group.id}` ? (
                  <InlineInput
                    aria-label="Group name"
                    initial={group.name}
                    className="ml-1 max-w-64 font-semibold"
                    onSave={(name) => {
                      setRenaming(null)
                      if (name.trim() && name.trim() !== group.name)
                        actions.renameGroup.mutate({
                          id: group.id,
                          name: name.trim(),
                        })
                    }}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <span className="ml-1 truncate">{group.name}</span>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Add a category to ${group.name}`}
                  onClick={() => {
                    setAddingTo(group.id)
                    if (!open) toggle(group.id)
                  }}
                  className="ml-1 size-7 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                >
                  <PlusIcon />
                </Button>
                <GroupMenu
                  group={group}
                  onRename={() => setRenaming(`g${group.id}`)}
                  onDelete={() => void del.start({ kind: "group", group })}
                />
              </span>
              <GroupFigure value={group.budgeted} currency={currency} />
              <GroupFigure value={0 - group.activity} currency={currency} />
              <GroupFigure
                value={group.available}
                currency={currency}
                className={cn("pr-2", group.available < 0 && "text-negative")}
              />
            </div>

            {open &&
              categories.map((category) => {
                const selected = category.id === selectedId
                return (
                  <div
                    key={category.id}
                    role="row"
                    aria-selected={selected}
                    onClick={() => onSelect(selected ? null : category.id)}
                    className={cn(
                      COLUMNS,
                      "group/row h-10 cursor-default border-b transition-colors hover:bg-muted/50",
                      selected && "bg-muted hover:bg-muted",
                      category.hidden && "text-muted-foreground"
                    )}
                  >
                    <span
                      role="rowheader"
                      className="flex min-w-0 items-center pl-6"
                    >
                      {renaming === `c${category.id}` ? (
                        <InlineInput
                          aria-label="Category name"
                          initial={category.name}
                          className="-ml-2 max-w-64"
                          onSave={(name) => {
                            setRenaming(null)
                            if (name.trim() && name.trim() !== category.name)
                              actions.rename.mutate({
                                id: category.id,
                                name: name.trim(),
                              })
                          }}
                          onCancel={() => setRenaming(null)}
                        />
                      ) : (
                        <span className="truncate">{category.name}</span>
                      )}
                      <span className="ml-1">
                        <CategoryMenu
                          category={category}
                          groups={month.groups}
                          groupId={group.id}
                          onRename={() => setRenaming(`c${category.id}`)}
                          onDelete={() =>
                            void del.start({
                              kind: "category",
                              category,
                              groupId: group.id,
                            })
                          }
                        />
                      </span>
                    </span>
                    <span role="cell" className="flex justify-end">
                      <AssignedCell
                        month={month.month}
                        category={category}
                        currency={currency}
                        className="w-full"
                      />
                    </span>
                    <span role="cell" className="text-right">
                      <SpentLink
                        month={month.month}
                        category={category}
                        currency={currency}
                      />
                    </span>
                    <span
                      role="cell"
                      className="flex justify-end"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect(category.id)
                      }}
                    >
                      <AvailablePill
                        month={month}
                        category={category}
                        currency={currency}
                      />
                    </span>
                  </div>
                )
              })}

            {addingTo === group.id && (
              <NewRow
                label="New category"
                onSave={(name) => {
                  actions.create.mutate({ groupId: group.id, name })
                  setAddingTo(null)
                }}
                onCancel={() => setAddingTo(null)}
                indent
              />
            )}
          </div>
        )
      })}

      {del.dialog}
    </div>
  )
}

function GroupFigure({
  value,
  currency,
  className,
}: {
  value: number
  currency: string
  className?: string
}) {
  return (
    <span role="cell" className={cn("text-right tabular-nums", className)}>
      {formatMoney(value, currency, { symbol: false })}
    </span>
  )
}

function NewRow({
  label,
  onSave,
  onCancel,
  indent = false,
}: {
  label: string
  onSave: (name: string) => void
  onCancel: () => void
  indent?: boolean
}) {
  return (
    <div role="row" className={cn(COLUMNS, "h-10 border-b")}>
      <span role="cell" className={cn(indent ? "pl-4" : "pl-0")}>
        <InlineInput
          aria-label={label}
          placeholder={label}
          initial=""
          className="max-w-64"
          onSave={(name) => {
            if (!name.trim()) {
              onCancel()
              return
            }
            onSave(name.trim())
          }}
          onCancel={onCancel}
        />
      </span>
    </div>
  )
}

/**
 * The name field for a new group, at the end of the budget. It stands on its
 * own (not inside the table) so Add group works on a phone, with no
 * categories yet, and before the first month.
 */
export function NewGroupRow({ onDone }: { onDone: () => void }) {
  const { createGroup } = useCategoryActions()
  return (
    <div className="flex h-10 items-center border-b px-2">
      <InlineInput
        aria-label="New group"
        placeholder="New group"
        initial=""
        className="max-w-64"
        onSave={(name) => {
          if (name.trim()) createGroup.mutate({ name: name.trim() })
          onDone()
        }}
        onCancel={onDone}
      />
    </div>
  )
}
