import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { live } from "./live"
import type { Account } from "@/shared/types"
import { Money } from "@/components/money"
import { QueryState, SkeletonRows } from "@/components/states"
import { Card, CardContent } from "@/components/ui/card"
import { queries } from "@/lib/api"
import { formatMoney } from "@/lib/format"

const GROUPS = [
  { label: "Cash", types: ["checking", "savings", "cash"] },
  { label: "Credit", types: ["credit"] },
  { label: "Investments", types: ["investment"] },
] as const

/**
 * Open accounts by kind, each in its own currency (the budget's without a
 * symbol), and a total in the budget's currency. An account in another
 * currency with no exchange rate yet is left out of the total, which says so.
 */
export function AccountsList({ currency }: { currency: string }) {
  const query = useQuery({ ...queries.accounts(), ...live })
  return (
    <Card className="h-full gap-0 py-5 shadow-none">
      <CardContent className="flex flex-col gap-3 px-5">
        <h2 className="text-sm font-medium">Accounts</h2>
        <QueryState query={query} skeleton={<SkeletonRows rows={5} />}>
          {(all) => {
            const open = all.filter((a) => !a.closed)
            const waiting = open.some((a) => a.budgetBalance === null)
            const total = open.reduce((s, a) => s + (a.budgetBalance ?? 0), 0)
            return (
              <div className="flex flex-col gap-3 text-sm">
                {GROUPS.map((group) => {
                  const accounts = open
                    .filter((a) =>
                      (group.types as readonly string[]).includes(a.type)
                    )
                    .sort((a, b) => a.name.localeCompare(b.name))
                  if (!accounts.length) return null
                  return (
                    <div key={group.label} className="flex flex-col">
                      <h3 className="pb-1 text-xs text-muted-foreground">
                        {group.label}
                      </h3>
                      {accounts.map((a) => (
                        <AccountRow key={a.id} account={a} budget={currency} />
                      ))}
                    </div>
                  )
                })}
                <div className="flex h-10 items-center justify-between gap-4 border-t pt-1">
                  <span className="text-muted-foreground">
                    Total{waiting && " · waiting for exchange rates"}
                  </span>
                  <Money
                    cents={total}
                    currency={currency}
                    className="font-medium"
                  />
                </div>
              </div>
            )
          }}
        </QueryState>
      </CardContent>
    </Card>
  )
}

function AccountRow({ account, budget }: { account: Account; budget: string }) {
  return (
    <Link
      to="/accounts/$id"
      params={{ id: String(account.id) }}
      className="-mx-2 flex h-8 items-center justify-between gap-4 rounded-md px-2 hover:bg-muted/60"
    >
      <span className="truncate">{account.name}</span>
      <span className="tabular-nums">
        {formatMoney(account.balance, account.currency, {
          symbol: account.currency !== budget,
        })}
      </span>
    </Link>
  )
}
