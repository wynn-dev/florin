// Small pieces the transactions table, the phone list and Activity's
// read-only rows share.
import { useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { CategoryPicker } from "@/components/category-picker"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ReactNode } from "react"
import type { Account, Transaction } from "@/shared/types"

/** Text that truncates, with the whole of it in a Tooltip only when it doesn't fit. */
export function TruncatedText({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        const el = ref.current
        setOpen(next && !!el && el.scrollWidth > el.clientWidth)
      }}
    >
      <TooltipTrigger asChild>
        <span ref={ref} className={cn("block truncate", className)}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

/** "→ Savings" for money going out to another account, "← Current account" for money coming in. */
export function transferText(t: Transaction): string | null {
  if (!t.transferAccountName) return null
  return `${t.amount <= 0 ? "→" : "←"} ${t.transferAccountName}`
}

/**
 * What the payee cell reads: the payee, or for a transfer "Transfer" (the
 * category cell names the other account), or the other account when the
 * category cell holds the budget category of a transfer out of the budget.
 */
export function payeeText(t: Transaction): string {
  if (t.transferId) return (t.categoryId && transferText(t)) || "Transfer"
  return t.payeeName ?? t.importedPayee ?? ""
}

/**
 * Whether a transaction takes a category: on-budget accounts only, and a
 * transfer only when it leaves the budget (into a tracking account).
 */
export function takesCategory(
  t: Transaction,
  accounts: Map<number, Account>
): boolean {
  const own = accounts.get(t.accountId)
  if (own && !own.onBudget) return false
  if (!t.transferAccountId) return true
  return !accounts.get(t.transferAccountId)?.onBudget
}

/** The category cell: the inline picker ("Categorise" when empty), or the transfer's other account. */
export function CategoryCell({
  t,
  accounts,
  onPick,
}: {
  t: Transaction
  accounts: Map<number, Account>
  onPick: (categoryId: number) => void
}) {
  if (!takesCategory(t, accounts) || (t.transferId && !t.categoryId)) {
    return <span className="block truncate">{transferText(t)}</span>
  }
  return (
    <CategoryPicker
      variant="inline"
      value={t.categoryId ? { type: "category", id: t.categoryId } : null}
      onChange={(choice) => {
        if (choice.type === "category" && choice.id !== t.categoryId)
          onPick(choice.id)
      }}
    />
  )
}
