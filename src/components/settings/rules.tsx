import { useState } from "react"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { MoreHorizontalIcon, PlusIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import type {
  ApplyRulesResult,
  Rule,
  RuleInput,
  RuleTest,
} from "@/shared/types"
import { CategoryPicker } from "@/components/category-picker"
import { capitalise } from "@/components/settings/mcp"
import { useDebounced } from "@/components/settings/payees"
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { api, queries } from "@/lib/api"
import { cn } from "@/lib/utils"

/** The rules in order, each a row; add and edit in a dialog, reorder from a row's menu. */
export function RulesSettings() {
  const queryClient = useQueryClient()
  const rules = useQuery(queries.rules())
  // undefined: closed; null: a new rule.
  const [editing, setEditing] = useState<Rule | null | undefined>()
  const [applying, setApplying] = useState(false)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["rules"] })
  const save = useMutation({
    mutationFn: (inputs: RuleInput[]) =>
      api<Rule[]>("/rules", { method: "POST", body: { rules: inputs } }),
    onSuccess: (list) =>
      queryClient.setQueryData(queries.rules().queryKey, list),
    onError: (error) => {
      void invalidate()
      toast.error(capitalise(error.message))
    },
  })
  const move = (rule: Rule, position: number) => {
    // Reorder at once; the answer replaces it.
    queryClient.setQueryData<Rule[]>(queries.rules().queryKey, (list) => {
      if (!list) return list
      const next = list.filter((r) => r.id !== rule.id)
      next.splice(position - 1, 0, rule)
      return next.map((r, i) => ({ ...r, position: i + 1 }))
    })
    save.mutate([{ id: rule.id, position }])
  }
  const remove = useMutation({
    mutationFn: (rule: Rule) => api(`/rules/${rule.id}`, { method: "DELETE" }),
    onSuccess: (_, rule) => {
      toast("Deleted rule", {
        action: {
          label: "Undo",
          onClick: () =>
            save.mutate([
              {
                pattern: rule.pattern,
                payee: rule.payee,
                categoryId: rule.categoryId,
                position: rule.position,
              },
            ]),
        },
      })
    },
    onError: (error) => toast.error(capitalise(error.message)),
    onSettled: invalidate,
  })

  return (
    <div className="flex flex-col gap-4">
      <QueryState
        query={rules}
        skeleton={<SkeletonRows rows={6} />}
        error="Couldn't load rules."
      >
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="No rules yet">
              <Button onClick={() => setEditing(null)}>
                <PlusIcon />
                Add rule
              </Button>
            </EmptyState>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(null)}
                >
                  <PlusIcon />
                  Add rule
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setApplying(true)}
                >
                  Apply to existing transactions
                </Button>
              </div>
              <ol className="flex flex-col border-t">
                {list.map((rule, i) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    first={i === 0}
                    last={i === list.length - 1}
                    onEdit={() => setEditing(rule)}
                    onMove={(position) => move(rule, position)}
                    onDelete={() => remove.mutate(rule)}
                  />
                ))}
              </ol>
            </>
          )
        }
      </QueryState>
      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
      >
        <DialogContent className="sm:max-w-lg">
          {editing !== undefined && (
            <RuleForm
              rule={editing}
              saving={save.isPending}
              onSave={(input) =>
                save.mutate([input], { onSuccess: () => setEditing(undefined) })
              }
            />
          )}
        </DialogContent>
      </Dialog>
      <ApplyDialog open={applying} onOpenChange={setApplying} />
    </div>
  )
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

/** What a rule sets: "Albert Heijn · Groceries". */
function ruleResult(rule: Pick<Rule, "payee" | "categoryName">): string {
  return [rule.payee, rule.categoryName].filter(Boolean).join(" · ")
}

function RuleRow({
  rule,
  first,
  last,
  onEdit,
  onMove,
  onDelete,
}: {
  rule: Rule
  first: boolean
  last: boolean
  onEdit: () => void
  onMove: (position: number) => void
  onDelete: () => void
}) {
  return (
    <li className="group flex min-h-12 items-center gap-1 border-b">
      <button
        type="button"
        onClick={onEdit}
        className="-ml-2 flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-2 text-left text-sm hover:bg-muted/60 sm:flex-row sm:items-baseline sm:gap-2"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-muted-foreground">matches</span>
          <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem]">
            {rule.pattern}
          </code>
        </span>
        <span className="flex min-w-0 shrink-0 items-baseline gap-2 sm:max-w-[45%]">
          <span aria-hidden className="text-muted-foreground">
            →
          </span>
          <span className="truncate">{ruleResult(rule)}</span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label={`Rule ${rule.position} options`}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
          <DropdownMenuItem
            disabled={first}
            onSelect={() => onMove(rule.position - 1)}
          >
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={last}
            onSelect={() => onMove(rule.position + 1)}
          >
            Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function RuleForm({
  rule,
  saving,
  onSave,
}: {
  rule: Rule | null
  saving: boolean
  onSave: (input: RuleInput) => void
}) {
  const [pattern, setPattern] = useState(rule?.pattern ?? "")
  const [payee, setPayee] = useState(rule?.payee ?? "")
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? null)
  const [tried, setTried] = useState(false)
  const problem = !pattern
    ? "Enter a pattern."
    : !payee.trim() && categoryId === null
      ? "Set a payee, a category or both."
      : null

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (problem) return
        onSave({
          ...(rule ? { id: rule.id } : {}),
          pattern,
          payee: payee.trim() || null,
          categoryId,
        })
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle>{rule ? "Edit rule" : "New rule"}</DialogTitle>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="rule-pattern">Pattern</FieldLabel>
          <Input
            id="rule-pattern"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="albert heijn \d|^ah \d"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="font-mono"
            autoFocus
          />
          <PatternMatches pattern={pattern} payee={payee} />
        </Field>
        <Field>
          <FieldLabel htmlFor="rule-payee">Payee</FieldLabel>
          <Input
            id="rule-payee"
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            placeholder="Unchanged"
            autoComplete="off"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="rule-category">Category</FieldLabel>
          <div className="flex gap-1">
            <CategoryPicker
              id="rule-category"
              placeholder="Unchanged"
              value={
                categoryId === null
                  ? null
                  : { type: "category", id: categoryId }
              }
              onChange={(choice) => {
                if (choice.type === "category") setCategoryId(choice.id)
              }}
              className="min-w-0 flex-1"
            />
            {categoryId !== null && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                onClick={() => setCategoryId(null)}
                aria-label="Clear category"
              >
                <XIcon />
              </Button>
            )}
          </div>
        </Field>
      </FieldGroup>
      <DialogFooter className="mt-6 items-center">
        {tried && problem && (
          <p className="mr-auto text-sm text-destructive">{problem}</p>
        )}
        <Button type="submit" disabled={saving}>
          {saving && <Spinner />}
          {rule ? "Save" : "Add rule"}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** The live line under the pattern: how many transactions it matches, a few examples. */
function PatternMatches({
  pattern,
  payee,
}: {
  pattern: string
  payee: string
}) {
  const input = useDebounced({ pattern, payee: payee.trim() }, 250)
  const test = useQuery({
    queryKey: ["rule-test", input],
    queryFn: () =>
      api<RuleTest>("/rules/test", {
        method: "POST",
        body: { pattern: input.pattern, payee: input.payee || undefined },
      }),
    enabled: input.pattern !== "",
    retry: false,
    placeholderData: keepPreviousData,
  })
  if (!pattern) return null
  if (test.error)
    return (
      <p className="text-sm text-destructive">
        {capitalise(
          test.error.message.replace(
            /^the rule has a pattern that /,
            "the pattern "
          )
        )}
      </p>
    )
  const result = test.data
  if (!result) return <p className="text-sm text-muted-foreground">…</p>
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 text-sm text-muted-foreground transition-opacity",
        test.isPlaceholderData && "opacity-60"
      )}
    >
      <p className="tabular-nums">
        {result.matches === 0
          ? "Matches no transactions"
          : `Matches ${plural(result.matches, "transaction", "transactions")}`}
      </p>
      {result.examples.map((e) => (
        <p key={e.bankText} className="flex min-w-0 gap-1.5">
          <span className="truncate">{e.bankText}</span>
          {e.payee && e.payee !== e.bankText && (
            <>
              <span aria-hidden>→</span>
              <span className="shrink-0 truncate text-foreground">
                {e.payee}
              </span>
            </>
          )}
        </p>
      ))}
    </div>
  )
}

/** Applies the rules to existing transactions, once a dry run has said how many would change. */
function ApplyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const preview = useQuery({
    queryKey: ["rules", "apply-preview"],
    queryFn: () =>
      api<ApplyRulesResult>("/rules/apply", {
        method: "POST",
        body: { dryRun: true },
      }),
    enabled: open,
    gcTime: 0,
    staleTime: 0,
  })
  const apply = useMutation({
    mutationFn: () =>
      api<ApplyRulesResult>("/rules/apply", { method: "POST", body: {} }),
    onSuccess: (result) => {
      onOpenChange(false)
      toast(`Changed ${plural(result.changed, "transaction", "transactions")}`)
      void queryClient.invalidateQueries()
    },
    onError: (error) => toast.error(capitalise(error.message)),
  })
  const result = preview.data
  const changes = result?.changed ?? 0
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Apply rules to existing transactions
          </AlertDialogTitle>
          <AlertDialogDescription>
            {preview.isFetching || !result
              ? preview.error
                ? capitalise(preview.error.message)
                : "Checking…"
              : changes === 0
                ? "Nothing would change."
                : `Sets ${[
                    result.payeesSet &&
                      plural(result.payeesSet, "payee", "payees"),
                    result.categoriesSet &&
                      plural(result.categoriesSet, "category", "categories"),
                  ]
                    .filter(Boolean)
                    .join(
                      " and "
                    )} on ${plural(changes, "transaction", "transactions")}${
                    result.payeesRemoved
                      ? ` and removes ${plural(result.payeesRemoved, "payee", "payees")} left without transactions`
                      : ""
                  }. Edits made by hand stay.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={preview.isFetching || changes === 0 || apply.isPending}
            onClick={(e) => {
              e.preventDefault()
              apply.mutate()
            }}
          >
            {apply.isPending && <Spinner />}
            Apply
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
