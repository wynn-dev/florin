import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { live } from "./live"
import { Money } from "@/components/money"
import { QueryState } from "@/components/states"
import { Skeleton } from "@/components/ui/skeleton"
import { queries } from "@/lib/api"
import { currentMonth } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * "This month": spent of assigned with a bar, what's ready to assign, and
 * the categories over their budget, each a link to the month's budget.
 */
export function ThisMonth({ currency }: { currency: string }) {
  const month = currentMonth()
  const query = useQuery({ ...queries.budget(month), ...live })
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">This month</h2>
        <Link
          to="/budget/$month"
          params={{ month }}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Budget
        </Link>
      </div>
      <QueryState
        query={query}
        skeleton={
          <div className="flex flex-col gap-2.5" aria-hidden>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        }
      >
        {(budget) => {
          const spent = 0 - budget.activity || 0
          const share = budget.budgeted > 0 ? spent / budget.budgeted : 0
          const over = budget.groups
            .flatMap((g) => g.categories)
            .filter((c) => c.available < 0)
            .sort((a, b) => a.available - b.available)
          return (
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-2">
                <p className="flex flex-wrap items-baseline gap-x-1.5">
                  <Money
                    cents={spent}
                    currency={currency}
                    tabular={false}
                    className="text-xl font-semibold tracking-tight"
                  />
                  <span className="text-muted-foreground">
                    {budget.budgeted > 0 ? (
                      <>
                        spent of{" "}
                        <Money cents={budget.budgeted} currency={currency} />{" "}
                        assigned
                      </>
                    ) : (
                      "spent, nothing assigned yet"
                    )}
                  </span>
                </p>
                {budget.budgeted > 0 && (
                  <div
                    role="meter"
                    aria-label="Spent of assigned"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(share * 100)}
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className={cn(
                        "h-full rounded-full",
                        share > 1 ? "bg-negative" : "bg-chart-1"
                      )}
                      style={{ width: `${Math.min(100, share * 100)}%` }}
                    />
                  </div>
                )}
              </div>
              <Link
                to="/budget/$month"
                params={{ month }}
                className="-mx-2 flex items-baseline justify-between gap-4 rounded-md px-2 py-1 hover:bg-muted/60"
              >
                <span className="text-muted-foreground">Ready to assign</span>
                {budget.toBudget === 0 ? (
                  <span className="text-muted-foreground">All assigned</span>
                ) : (
                  <Money
                    cents={budget.toBudget}
                    currency={currency}
                    className={cn(budget.toBudget < 0 && "text-negative")}
                  />
                )}
              </Link>
              {over.slice(0, 3).map((c) => (
                <Link
                  key={c.id}
                  to="/budget/$month"
                  params={{ month }}
                  className="-mx-2 flex items-baseline justify-between gap-4 rounded-md px-2 py-1 hover:bg-muted/60"
                >
                  <span className="truncate">
                    {c.name}
                    <span className="text-muted-foreground"> over budget</span>
                  </span>
                  <Money
                    cents={c.available}
                    currency={currency}
                    className="text-negative"
                  />
                </Link>
              ))}
              {over.length > 3 && (
                <Link
                  to="/budget/$month"
                  params={{ month }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {over.length - 3} more over budget
                </Link>
              )}
            </div>
          )
        }}
      </QueryState>
    </section>
  )
}
