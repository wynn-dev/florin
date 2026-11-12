// The parts of a budget month both layouts share.
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import { InlineInput } from "./cells"
import { useCoverOverspending, useSetGoal } from "./queries"
import type { ReactNode } from "react"
import type { BudgetMonth } from "@/shared/types"
import { cn } from "@/lib/utils"
import {
  formatAmountInput,
  formatMoney,
  formatMonth,
  parseAmount,
} from "@/lib/format"
import { EmptyState } from "@/components/states"
import { Button } from "@/components/ui/button"

/**
 * The money not planned yet, in its three states: "€8,707.85 not planned
 * yet", "Everything is planned", and in red "You planned €500.00 more than
 * you have".
 */
export function NotPlannedYet({
  amount,
  currency,
  small = false,
  className,
}: {
  amount: number
  currency: string
  /** Second to the monthly goal: one line of body text. */
  small?: boolean
  className?: string
}) {
  if (small)
    return (
      <p
        className={cn(
          "text-sm text-muted-foreground",
          amount < 0 && "text-negative",
          className
        )}
      >
        {amount === 0 ? (
          "Everything is planned"
        ) : amount > 0 ? (
          <>
            <span className="text-foreground tabular-nums">
              {formatMoney(amount, currency)}
            </span>{" "}
            not planned yet
          </>
        ) : (
          <>
            You planned{" "}
            <span className="tabular-nums">
              {formatMoney(-amount, currency)}
            </span>{" "}
            more than you have
          </>
        )}
      </p>
    )
  if (amount === 0)
    return (
      <p className={cn("text-2xl text-muted-foreground", className)}>
        Everything is planned
      </p>
    )
  if (amount < 0)
    return (
      <p className={cn("text-lg text-negative", className)}>
        You planned{" "}
        <span className="font-semibold tracking-tight tabular-nums">
          {formatMoney(-amount, currency)}
        </span>{" "}
        more than you have
      </p>
    )
  return (
    <p className={cn("flex items-baseline gap-2", className)}>
      <span className="text-2xl font-semibold tracking-tight">
        {formatMoney(amount, currency)}
      </span>
      <span className="text-sm text-muted-foreground">not planned yet</span>
    </p>
  )
}

/**
 * The monthly goal, first on the page when one is set: "€3,210.00 spent of
 * €5,000.00", a bar, then "€1,790.00 left" (or in red "€1,552.00 over your
 * €5,000.00 goal") with the money not planned yet beside it, and a short line
 * when the month's plan is above the goal. Click the goal to change it;
 * cleared, the goal goes. `editing` with no goal yet asks for one.
 */
export function GoalHeadline({
  month,
  currency,
  editing,
  onEditingChange,
  className,
}: {
  month: BudgetMonth
  currency: string
  editing: boolean
  onEditingChange: (editing: boolean) => void
  className?: string
}) {
  const [invalid, setInvalid] = useState(false)
  const setGoal = useSetGoal()
  const goal = month.goal
  const input = (
    <InlineInput
      aria-label="Monthly goal"
      inputMode="decimal"
      initial={goal ? formatAmountInput(goal.amount, currency) : ""}
      onSave={(text) => {
        const empty = text.trim() === ""
        const amount = empty ? null : parseAmount(text, currency)
        if (!empty && (amount === null || amount <= 0)) {
          setInvalid(true)
          return false
        }
        setInvalid(false)
        onEditingChange(false)
        if (amount !== (goal?.amount ?? null))
          setGoal.mutate({ amount, previous: goal?.amount ?? null })
      }}
      onCancel={() => {
        setInvalid(false)
        onEditingChange(false)
      }}
      className={cn(
        "inline-block h-8 w-32 text-right text-base text-foreground tabular-nums",
        invalid && "border-destructive"
      )}
    />
  )
  if (!goal)
    return editing ? (
      <div
        className={cn(
          "flex items-center gap-2 text-sm text-muted-foreground",
          className
        )}
      >
        Spend at most
        {input}a month
      </div>
    ) : null
  const share = goal.amount > 0 ? goal.spent / goal.amount : 0
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {formatMoney(Math.max(0, goal.spent), currency)}
        </span>
        <span className="flex items-baseline gap-1 text-muted-foreground">
          spent of
          {editing ? (
            input
          ) : (
            <button
              type="button"
              onClick={() => onEditingChange(true)}
              aria-label={`Monthly goal: ${formatMoney(goal.amount, currency)}. Edit`}
              className="-mx-1 rounded-md px-1 text-foreground tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {formatMoney(goal.amount, currency)}
            </button>
          )}
        </span>
      </p>
      <div
        role="meter"
        aria-label="Spent of the monthly goal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(1, share) * 100)}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full",
            share > 1 ? "bg-negative" : "bg-chart-1"
          )}
          style={{ width: `${Math.min(100, Math.max(0, share) * 100)}%` }}
        />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm">
        {goal.left >= 0 ? (
          <span className="text-muted-foreground">
            <span className="text-foreground tabular-nums">
              {formatMoney(goal.left, currency)}
            </span>{" "}
            left
          </span>
        ) : (
          <span className="text-negative">
            <span className="tabular-nums">
              {formatMoney(-goal.left, currency)}
            </span>{" "}
            over your {formatMoney(goal.amount, currency)} goal
          </span>
        )}
        {!beforeFirstMonth(month) && (
          <NotPlannedYet amount={month.toBudget} currency={currency} small />
        )}
      </div>
      {goal.planned > goal.amount && (
        <p className="text-sm text-muted-foreground">
          This month&apos;s plan adds up to{" "}
          <span className="tabular-nums">
            {formatMoney(goal.planned, currency)}
          </span>
          , more than the goal
        </p>
      )}
    </div>
  )
}

/**
 * Cover what went over: plans what each category over plan is over, from the
 * money not planned yet. When that isn't enough it says by how much and
 * changes nothing.
 */
export function CoverButton({
  month,
  currency,
  className,
}: {
  month: BudgetMonth
  currency: string
  className?: string
}) {
  const cover = useCoverOverspending(month.month)
  const short = month.overspent - Math.max(0, month.toBudget)
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={cover.isPending}
      className={className}
      onClick={() => {
        if (short <= 0) cover.mutate()
        else
          toast(
            `${formatMoney(short, currency)} short to cover it: ${
              month.toBudget > 0
                ? `only ${formatMoney(month.toBudget, currency)} is not planned yet`
                : "all your money is already planned"
            }`
          )
      }}
    >
      Cover what went over
    </Button>
  )
}

/** "€618.60 over plan · Cover what went over", where the month panel isn't shown. */
export function OverPlan({
  month,
  currency,
  className,
}: {
  month: BudgetMonth
  currency: string
  className?: string
}) {
  if (month.overspent <= 0) return null
  return (
    <div className={cn("flex items-center gap-3 text-sm", className)}>
      <span className="text-negative tabular-nums">
        {formatMoney(month.overspent, currency)} over plan
      </span>
      <CoverButton month={month} currency={currency} />
    </div>
  )
}

/**
 * The table, or what stands in for it: no categories yet, or a month before
 * the first transaction ("Nothing to plan before March 2025").
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
        title={`Nothing to plan before ${formatMonth(month.firstMonth)}`}
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

/** A month before the first transaction: nothing to plan yet. */
export function beforeFirstMonth(month: BudgetMonth): boolean {
  return month.firstMonth === null || month.month < month.firstMonth
}
