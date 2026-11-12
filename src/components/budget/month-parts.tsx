// The parts of a budget month both layouts share.
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { BudgetMonth } from "@/shared/types"
import { cn } from "@/lib/utils"
import { formatMoney, formatMonth } from "@/lib/format"
import { EmptyState } from "@/components/states"
import { Button } from "@/components/ui/button"

/** Ready to assign in its three states: positive, all assigned, over-assigned. */
export function ReadyToAssign({
  amount,
  currency,
  className,
}: {
  amount: number
  currency: string
  className?: string
}) {
  if (amount === 0)
    return (
      <p className={cn("text-2xl text-muted-foreground", className)}>
        All money assigned
      </p>
    )
  return (
    <p className={cn("flex items-baseline gap-2", className)}>
      <span
        className={cn(
          "text-2xl font-semibold tracking-tight",
          amount < 0 && "text-negative"
        )}
      >
        {formatMoney(amount, currency)}
      </span>
      <span
        className={cn(
          "text-sm text-muted-foreground",
          amount < 0 && "text-negative"
        )}
      >
        {amount > 0 ? "ready to assign" : "assigned more than you have"}
      </span>
    </p>
  )
}

/**
 * The table, or what stands in for it: no categories yet, or a month before
 * the first transaction ("Nothing budgeted before March 2025").
 */
export function BudgetBody({
  month,
  onAddGroup,
  children,
}: {
  month: BudgetMonth
  onAddGroup: () => void
  children: ReactNode
}) {
  if (month.groups.length === 0)
    return (
      <EmptyState title="No categories yet">
        <Button onClick={onAddGroup}>Add group</Button>
      </EmptyState>
    )
  if (month.firstMonth && month.month < month.firstMonth)
    return (
      <EmptyState
        title={`Nothing budgeted before ${formatMonth(month.firstMonth)}`}
      >
        <Button variant="outline" asChild>
          <Link to="/budget/$month" params={{ month: month.firstMonth }}>
            Go to {formatMonth(month.firstMonth)}
          </Link>
        </Button>
      </EmptyState>
    )
  return <>{children}</>
}
