import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { live } from "./live"
import { Money } from "@/components/money"
import { QueryState } from "@/components/states"
import { Skeleton } from "@/components/ui/skeleton"
import { queries } from "@/lib/api"
import { currentMonth } from "@/lib/format"
import { cn } from "@/lib/utils"

/** "This month": spent of budgeted, and what's ready to assign. */
export function ThisMonth({ currency }: { currency: string }) {
  const month = currentMonth()
  const query = useQuery({ ...queries.budget(month), ...live })
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">This month</h2>
      <QueryState
        query={query}
        skeleton={
          <div className="flex flex-col gap-2.5" aria-hidden>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        }
      >
        {(budget) => (
          <dl className="flex flex-col gap-1.5 text-sm">
            <Line label="Spent" to={month}>
              <Money cents={-budget.activity} currency={currency} />
              <span className="text-muted-foreground">
                {" "}
                of <Money cents={budget.budgeted} currency={currency} />
              </span>
            </Line>
            <Line label="Ready to assign" to={month}>
              <Money
                cents={budget.toBudget}
                currency={currency}
                className={cn(budget.toBudget < 0 && "text-negative")}
              />
            </Line>
          </dl>
        )}
      </QueryState>
    </section>
  )
}

function Line({
  label,
  to,
  children,
}: {
  label: string
  to: string
  children: React.ReactNode
}) {
  return (
    <Link
      to={"/budget/$month" as never}
      params={{ month: to } as never}
      className="-mx-2 flex items-baseline justify-between gap-4 rounded-md px-2 py-1 hover:bg-muted/60"
    >
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </Link>
  )
}
