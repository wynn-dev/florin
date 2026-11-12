// Category and group management: each row's ⋯ menu, deleting with
// reassignment, and the API calls behind them.
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { MoreHorizontalIcon } from "lucide-react"
import { toast } from "sonner"
import { budgetQueries, useCategoryEdit } from "./queries"
import type { BudgetCategory, BudgetGroup } from "@/shared/types"
import type { CategoryChoice } from "@/components/category-picker"
import { api } from "@/lib/api"
import { useAfterClose } from "@/hooks/use-after-close"
import { CategoryPicker } from "@/components/category-picker"
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"

export function useCategoryActions() {
  const rename = useCategoryEdit(
    (v: { id: number; name: string }) =>
      api(`/categories/${v.id}`, { method: "PATCH", body: { name: v.name } }),
    "Couldn't rename"
  )
  const update = useCategoryEdit(
    (v: {
      id: number
      hidden?: boolean
      groupId?: number
      outsideGoal?: boolean
    }) =>
      api(`/categories/${v.id}`, {
        method: "PATCH",
        body: {
          hidden: v.hidden,
          groupId: v.groupId,
          outsideGoal: v.outsideGoal,
        },
      }),
    "Couldn't change the category"
  )
  const create = useCategoryEdit(
    (v: { groupId: number; name: string }) =>
      api<{ id: number }>("/categories", { method: "POST", body: v }),
    "Couldn't add the category"
  )
  const remove = useCategoryEdit(
    (v: { id: number; transferTo?: number }) =>
      api(
        `/categories/${v.id}${v.transferTo ? `?transferTo=${v.transferTo}` : ""}`,
        { method: "DELETE" }
      ),
    "Couldn't delete the category"
  )
  const createGroup = useCategoryEdit(
    (v: { name: string }) =>
      api("/category-groups", { method: "POST", body: v }),
    "Couldn't add the group"
  )
  const renameGroup = useCategoryEdit(
    (v: { id: number; name: string }) =>
      api(`/category-groups/${v.id}`, {
        method: "PATCH",
        body: { name: v.name },
      }),
    "Couldn't rename the group"
  )
  const removeGroup = useCategoryEdit(
    (v: { id: number; transferTo?: number }) =>
      api(
        `/category-groups/${v.id}${v.transferTo ? `?transferTo=${v.transferTo}` : ""}`,
        { method: "DELETE" }
      ),
    "Couldn't delete the group"
  )
  return {
    rename,
    update,
    create,
    remove,
    createGroup,
    renameGroup,
    removeGroup,
  }
}

const menuButton =
  "size-7 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"

/** A category row's ⋯: Rename, Move to group…, Hide, Counts toward goal (with a goal set), Delete. */
export function CategoryMenu({
  category,
  groups,
  groupId,
  goalSet,
  onRename,
  onDelete,
}: {
  category: BudgetCategory
  groups: BudgetGroup[]
  groupId: number
  goalSet: boolean
  onRename: () => void
  onDelete: () => void
}) {
  const { update } = useCategoryActions()
  const after = useAfterClose()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={menuButton}
          aria-label={`${category.name} options`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52"
        onCloseAutoFocus={after.onCloseAutoFocus}
      >
        <DropdownMenuItem onSelect={after.later(onRename)}>
          Rename
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Move to group</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            {groups
              .filter((g) => g.id !== groupId)
              .map((g) => (
                <DropdownMenuItem
                  key={g.id}
                  onSelect={() =>
                    update.mutate({ id: category.id, groupId: g.id })
                  }
                >
                  {g.name}
                </DropdownMenuItem>
              ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          onSelect={() =>
            update.mutate({ id: category.id, hidden: !category.hidden })
          }
        >
          {category.hidden ? "Show" : "Hide"}
        </DropdownMenuItem>
        {goalSet && (
          <DropdownMenuCheckboxItem
            checked={!category.outsideGoal}
            onCheckedChange={(counts) =>
              update.mutate({ id: category.id, outsideGoal: !counts })
            }
          >
            Counts toward goal
          </DropdownMenuCheckboxItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A group row's ⋯: Rename, Delete. */
export function GroupMenu({
  group,
  onRename,
  onDelete,
}: {
  group: BudgetGroup
  onRename: () => void
  onDelete: () => void
}) {
  const after = useAfterClose()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={menuButton}
          aria-label={`${group.name} options`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-44"
        onCloseAutoFocus={after.onCloseAutoFocus}
      >
        <DropdownMenuItem onSelect={after.later(onRename)}>
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** What is being deleted: one category, or a group with its categories. */
export type Deleting =
  | { kind: "category"; category: BudgetCategory; groupId: number }
  | { kind: "group"; group: BudgetGroup }

/**
 * Deletes a category or group. A category with no transactions and no money
 * goes at once with an Undo toast; one with transactions or money asks where they go: "Move its 37
 * transactions to [category]".
 */
export function useDelete() {
  const [deleting, setDeleting] = useState<Deleting | null>(null)
  const client = useQueryClient()
  const { remove, create } = useCategoryActions()

  const start = async (target: Deleting) => {
    if (target.kind === "group") {
      setDeleting(target)
      return
    }
    const { category, groupId } = target
    const count = await client
      .fetchQuery(budgetQueries.transactionCount([category.id]))
      .catch(() => null)
    if (count !== 0 || category.available !== 0 || category.budgeted !== 0) {
      setDeleting(target)
      return
    }
    // mutateAsync rather than mutate's callbacks: the row (and its menu) is
    // gone by the time the delete succeeds.
    await remove.mutateAsync({ id: category.id }).then(
      () =>
        toast(`Deleted ${category.name}`, {
          action: {
            label: "Undo",
            onClick: () => create.mutate({ groupId, name: category.name }),
          },
        }),
      () => undefined
    )
  }

  const dialog = (
    <DeleteDialog deleting={deleting} onClose={() => setDeleting(null)} />
  )
  return { start, dialog }
}

function DeleteDialog({
  deleting,
  onClose,
}: {
  deleting: Deleting | null
  onClose: () => void
}) {
  const [target, setTarget] = useState<CategoryChoice | null>(null)
  const { remove, removeGroup } = useCategoryActions()
  const ids = !deleting
    ? []
    : deleting.kind === "category"
      ? [deleting.category.id]
      : deleting.group.categories.map((c) => c.id)
  const count = useQuery({
    ...budgetQueries.transactionCount(ids),
    enabled: ids.length > 0,
  })
  const name =
    deleting?.kind === "category"
      ? deleting.category.name
      : deleting?.group.name
  const pending = remove.isPending || removeGroup.isPending
  const transferTo = target?.type === "category" ? target.id : undefined
  const n = count.data ?? 0
  // A category always has something here (useDelete deletes empty ones at
  // once); a group asks only when its categories have transactions.
  const needsTarget =
    !count.isPending && (deleting?.kind === "category" || n > 0)

  const close = () => {
    setTarget(null)
    onClose()
  }
  const confirm = () => {
    if (!deleting) return
    const options = { onSuccess: close }
    if (deleting.kind === "category")
      remove.mutate({ id: deleting.category.id, transferTo }, options)
    else removeGroup.mutate({ id: deleting.group.id, transferTo }, options)
  }

  return (
    <AlertDialog open={!!deleting} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          {deleting?.kind === "group" && (
            <AlertDialogDescription>
              Its{" "}
              {ids.length === 1
                ? "category goes"
                : `${ids.length} categories go`}{" "}
              with it.
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {needsTarget && (
          <div className="flex flex-col gap-2 text-sm">
            <span>
              {n > 0
                ? `Move its ${n} transaction${n === 1 ? "" : "s"} to`
                : "Move its money to"}
            </span>
            <CategoryPicker
              value={target}
              onChange={setTarget}
              exclude={ids}
              placeholder="Choose a category"
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending || (needsTarget && n > 0 && !transferTo)}
            onClick={(e) => {
              e.preventDefault()
              confirm()
            }}
          >
            {pending && <Spinner />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
