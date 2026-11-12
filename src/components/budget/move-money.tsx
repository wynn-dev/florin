import { useState } from "react"
import { useMoveMoney } from "./queries"
import type { BudgetCategory, BudgetMonth } from "@/shared/types"
import type { CategoryChoice } from "@/components/category-picker"
import {
  currencySymbol,
  formatAmountInput,
  formatMoney,
  parseAmount,
} from "@/lib/format"
import { CategoryList } from "@/components/category-picker"

/**
 * Move money for one category: "Move €40.00 from Groceries to …", or for an
 * overspent one "Cover €42.10 from …". The amount is editable; the list has
 * Ready to assign first and each category's available money at its right;
 * picking one (Enter or click) applies, with an Undo toast.
 */
export function MoveMoney({
  month,
  category,
  currency,
  onDone,
}: {
  month: BudgetMonth
  category: BudgetCategory
  currency: string
  onDone: () => void
}) {
  const cover = category.available < 0
  const [text, setText] = useState(() =>
    category.available === 0
      ? ""
      : formatAmountInput(category.available, currency)
  )
  const amount = parseAmount(text, currency)
  const move = useMoveMoney(month.month)

  const available = new Map(
    month.groups.flatMap((g) => g.categories.map((c) => [c.id, c.available]))
  )
  const name = new Map(
    month.groups.flatMap((g) => g.categories.map((c) => [c.id, c.name]))
  )
  const label = (id: number | null) =>
    id === null ? "Ready to assign" : (name.get(id) ?? "")

  const apply = (choice: CategoryChoice) => {
    if (!amount) return
    const other = choice.type === "category" ? choice.id : null
    const forward = cover
      ? { fromCategoryId: other, toCategoryId: category.id, amount }
      : { fromCategoryId: category.id, toCategoryId: other, amount }
    move.mutate({
      ...forward,
      toast: `Moved ${formatMoney(amount, currency)} to ${label(forward.toCategoryId)}`,
    })
    onDone()
  }

  return (
    <div data-move-money className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-4 pt-3 pb-2 text-sm">
        <span>{cover ? "Cover" : "Move"}</span>
        <label className="flex h-7 items-center rounded-md border border-input bg-transparent px-2 tabular-nums focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
          <span className="text-muted-foreground">
            {currencySymbol(currency)}
          </span>
          <input
            aria-label="Amount"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              // Enter goes on to the list, where Enter picks and applies.
              if (e.key !== "Enter") return
              e.preventDefault()
              e.currentTarget
                .closest("[data-move-money]")
                ?.querySelector<HTMLInputElement>("[data-slot=command-input]")
                ?.focus()
            }}
            aria-invalid={text !== "" && !amount}
            className="w-20 bg-transparent pl-0.5 text-right outline-none"
          />
        </label>
        {cover ? (
          <span>from</span>
        ) : (
          <span className="min-w-0">
            from <span className="font-medium">{category.name}</span> to
          </span>
        )}
      </div>
      <div className="border-t [&_[data-slot=command-input-wrapper]]:px-3 [&_[data-slot=command-list]]:max-h-64">
        <CategoryList
          value={null}
          onSelect={apply}
          readyToAssign
          expensesOnly
          exclude={[category.id]}
          recent={[]}
          autoFocus
          trailing={(choice) =>
            formatMoney(
              choice.type === "category"
                ? (available.get(choice.id) ?? 0)
                : month.toBudget,
              currency
            )
          }
        />
      </div>
    </div>
  )
}
