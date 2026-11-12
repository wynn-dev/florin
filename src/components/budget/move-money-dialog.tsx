import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useMoveMoney } from "./queries"
import type { CategoryChoice } from "@/components/category-picker"
import { queries } from "@/lib/api"
import {
  currencySymbol,
  currentMonth,
  formatMoney,
  formatMonth,
  parseAmount,
} from "@/lib/format"
import { CategoryPicker } from "@/components/category-picker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"

const id = (choice: CategoryChoice | null) =>
  choice?.type === "category" ? choice.id : null

/**
 * Move money on its own (from ⌘K): from, to and an amount, for the current
 * month. Ready to assign is a choice on either side. Undo is in the toast.
 */
export function MoveMoneyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <MoveForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function MoveForm({ onDone }: { onDone: () => void }) {
  const month = currentMonth()
  const currency = useQuery(queries.settings()).data?.currency ?? "EUR"
  const budget = useQuery(queries.budget(month)).data
  const [from, setFrom] = useState<CategoryChoice | null>({
    type: "ready-to-assign",
  })
  const [to, setTo] = useState<CategoryChoice | null>(null)
  const [text, setText] = useState("")
  const [tried, setTried] = useState(false)
  const amount = parseAmount(text, currency)
  const move = useMoveMoney(month)

  const name = (choice: CategoryChoice | null) =>
    choice?.type === "category"
      ? (budget?.groups
          .flatMap((g) => g.categories)
          .find((c) => c.id === choice.id)?.name ?? "")
      : "Ready to assign"
  const available = (choice: CategoryChoice | null) =>
    choice?.type === "category"
      ? budget?.groups
          .flatMap((g) => g.categories)
          .find((c) => c.id === choice.id)?.available
      : budget?.toBudget

  const same = !!from && !!to && id(from) === id(to)
  const problem = !to
    ? "Pick where the money goes."
    : same
      ? "Pick two different places."
      : !amount
        ? "Enter an amount."
        : null
  const left = available(from)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (problem || !amount) return
        move.mutate({
          fromCategoryId: id(from),
          toCategoryId: id(to),
          amount,
          toast: `Moved ${formatMoney(amount, currency)} from ${name(from)} to ${name(to)}`,
        })
        onDone()
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle>Move money · {formatMonth(month)}</DialogTitle>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="move-from">From</FieldLabel>
          <CategoryPicker
            id="move-from"
            value={from}
            onChange={setFrom}
            readyToAssign
            expensesOnly
          />
          {left !== undefined && (
            <p className="text-sm text-muted-foreground tabular-nums">
              {formatMoney(left, currency)} available
            </p>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="move-to">To</FieldLabel>
          <CategoryPicker
            id="move-to"
            value={to}
            onChange={setTo}
            readyToAssign
            expensesOnly
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="move-amount">Amount</FieldLabel>
          <InputGroup>
            <InputGroupAddon>{currencySymbol(currency)}</InputGroupAddon>
            <InputGroupInput
              id="move-amount"
              inputMode="decimal"
              autoComplete="off"
              className="tabular-nums"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </InputGroup>
        </Field>
        {tried && problem && <FieldError>{problem}</FieldError>}
      </FieldGroup>
      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">Move</Button>
      </DialogFooter>
    </form>
  )
}
