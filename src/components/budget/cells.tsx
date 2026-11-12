// The editable pieces of a budget row, shared by the desktop table, the
// inspector and the phone drawer.
import { useEffect, useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import { MoveMoney } from "./move-money"
import { useAssign } from "./queries"
import type { ReactNode } from "react"
import type { BudgetCategory, BudgetMonth } from "@/shared/types"
import { cn } from "@/lib/utils"
import {
  firstDay,
  formatAmountInput,
  formatLeft,
  formatMoney,
  lastDay,
  parseAmount,
} from "@/lib/format"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

/**
 * A one-line text input that saves on Enter (or when it loses focus) and
 * cancels on Esc. `onSave` gets the text; return false to keep editing.
 */
export function InlineInput({
  initial,
  onSave,
  onCancel,
  className,
  ...props
}: {
  initial: string
  onSave: (text: string) => boolean | void
  onCancel: () => void
  className?: string
  "aria-label": string
  inputMode?: "decimal" | "text"
  placeholder?: string
}) {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    // After the menu that opened it has closed and let go of focus.
    const timer = setTimeout(() => {
      ref.current?.focus()
      ref.current?.select()
    }, 0)
    return () => clearTimeout(timer)
  }, [])
  const save = () => {
    if (done.current) return
    if (onSave(text) === false) return
    done.current = true
  }
  return (
    <input
      ref={ref}
      autoComplete="off"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          save()
        } else if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          done.current = true
          onCancel()
        }
      }}
      onBlur={() => {
        if (!done.current) {
          done.current = true
          onCancel()
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

/**
 * What is planned for a category this month: reads as text, click to edit in
 * a small input. Enter saves (optimistically), Esc cancels. Plain numbers.
 */
export function AssignedCell({
  month,
  category,
  currency,
  symbol = false,
  className,
}: {
  month: string
  category: BudgetCategory
  currency: string
  symbol?: boolean
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const assign = useAssign(month)

  if (editing)
    return (
      <InlineInput
        aria-label={`Planned for ${category.name}`}
        inputMode="decimal"
        initial={
          category.budgeted === 0
            ? ""
            : formatAmountInput(category.budgeted, currency)
        }
        onSave={(text) => {
          const amount = text.trim() === "" ? 0 : parseAmount(text, currency)
          if (amount === null) {
            setInvalid(true)
            return false
          }
          setEditing(false)
          setInvalid(false)
          if (amount !== category.budgeted)
            assign.mutate({
              categoryId: category.id,
              amount,
              previous: category.budgeted,
            })
        }}
        onCancel={() => {
          setEditing(false)
          setInvalid(false)
        }}
        className={cn(
          "-my-1 h-7 text-right tabular-nums",
          invalid && "border-destructive",
          className
        )}
      />
    )
  return (
    <button
      type="button"
      onClick={(e) => {
        // Editing keeps the row selected rather than toggling it.
        e.stopPropagation()
        setEditing(true)
      }}
      aria-label={`Planned for ${category.name}: ${formatMoney(category.budgeted, currency)}. Edit`}
      className={cn(
        "-mx-2 h-7 rounded-md px-2 text-right tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
        category.budgeted === 0 && "text-muted-foreground",
        className
      )}
    >
      {formatMoney(category.budgeted, currency, { symbol })}
    </button>
  )
}

/** Spent this month (outflows positive), linking to those transactions. */
export function SpentLink({
  month,
  category,
  currency,
  symbol = false,
  className,
}: {
  month: string
  category: BudgetCategory
  currency: string
  symbol?: boolean
  className?: string
}) {
  const spent = 0 - category.activity
  return (
    <Link
      to="/transactions"
      // The Transactions page's filters: categories, then the month's dates.
      search={
        {
          categoryIds: [category.id],
          from: firstDay(month),
          to: lastDay(month),
        } as never
      }
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "rounded-sm tabular-nums underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
        spent === 0 && "text-muted-foreground",
        className
      )}
    >
      {formatMoney(spent, currency, { symbol })}
    </Link>
  )
}

/** The Left figure: a muted pill when positive, plain muted at zero, a red pill when over. */
export function availableLook(available: number): string {
  // On a selected (muted) row the pill turns to the background colour.
  if (available > 0)
    return "bg-muted text-foreground in-aria-selected:bg-background"
  if (available < 0) return "bg-negative/10 text-negative"
  return "text-muted-foreground"
}

export function AvailablePillText({
  available,
  currency,
  className,
}: {
  available: number
  currency: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md px-2 text-sm font-medium whitespace-nowrap tabular-nums",
        availableLook(available),
        className
      )}
    >
      {formatLeft(available, currency)}
    </span>
  )
}

/** The Left pill; clicking it opens Move money (Cover, when over). */
export function AvailablePill({
  month,
  category,
  currency,
}: {
  month: BudgetMonth
  category: BudgetCategory
  currency: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${category.name}: ${category.available < 0 ? `${formatLeft(category.available, currency)}. Cover it` : `${formatLeft(category.available, currency)} left. Move money`}`}
          className="-my-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&>span]:transition-colors hover:[&>span]:ring-1 hover:[&>span]:ring-foreground/15 aria-expanded:[&>span]:ring-1 aria-expanded:[&>span]:ring-foreground/25"
        >
          <AvailablePillText
            available={category.available}
            currency={currency}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 gap-0 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <MoveMoney
          month={month}
          category={category}
          currency={currency}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

/** A label and a figure on one line, for the inspector and the phone drawer. */
export function Figure({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex h-8 items-center justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="pr-2 tabular-nums">{children}</dd>
    </div>
  )
}
