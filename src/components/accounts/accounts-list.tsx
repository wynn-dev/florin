import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronDownIcon } from "lucide-react"
import { AddAccountDialog } from "./add-account"
import { SECTIONS } from "./queries"
import { ConnectionState } from "./connection"
import type { AddStep } from "./add-account"
import type { Account } from "@/shared/types"
import { cn } from "@/lib/utils"
import { queries } from "@/lib/api"
import { formatMoney } from "@/lib/format"
import { Page } from "@/components/page"
import {
  EmptyState,
  QueryState,
  SkeletonFigure,
  SkeletonRows,
} from "@/components/states"
import { Button } from "@/components/ui/button"

/** A sum in the budget's currency; null when a foreign account has no rate yet. */
function total(accounts: Account[]): number | null {
  let sum = 0
  for (const a of accounts) {
    if (a.budgetBalance === null) return null
    sum += a.budgetBalance
  }
  return sum
}

/** Leaves out accounts without a rate, for "waiting for exchange rates". */
function knownTotal(accounts: Account[]): number {
  return accounts.reduce((s, a) => s + (a.budgetBalance ?? 0), 0)
}

export function AccountsList({
  add,
  onAddChange,
}: {
  add: AddStep | null
  onAddChange: (step: AddStep | null) => void
}) {
  const accounts = useQuery(queries.accounts())
  const currency = useQuery(queries.settings()).data?.currency
  const [showClosed, setShowClosed] = useState(false)

  return (
    <Page
      title="Accounts"
      actions={
        <Button onClick={() => onAddChange("choose")}>Add account</Button>
      }
    >
      <QueryState
        query={accounts}
        error="Couldn't load accounts."
        skeleton={
          <div className="flex max-w-3xl flex-col gap-8">
            <SkeletonFigure />
            <SkeletonRows rows={6} />
          </div>
        }
      >
        {(all) => {
          if (all.length === 0 || !currency)
            return (
              <EmptyState title="Add an account to get started">
                <Button onClick={() => onAddChange("manual")}>
                  Add account
                </Button>
                <Button variant="outline" onClick={() => onAddChange("bank")}>
                  Connect a bank
                </Button>
              </EmptyState>
            )
          const open = all.filter((a) => !a.closed)
          const closed = all.filter((a) => a.closed)
          const sum = total(open)
          return (
            <div className="flex w-full max-w-3xl flex-col gap-8">
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">
                  {sum === null
                    ? "Total · waiting for exchange rates"
                    : "Total"}
                </span>
                <span className="text-4xl font-semibold tracking-tight">
                  {formatMoney(sum ?? knownTotal(open), currency)}
                </span>
              </div>
              {SECTIONS.map((section) => {
                const rows = byName(
                  open.filter((a) => section.types.includes(a.type))
                )
                if (!rows.length) return null
                return (
                  <Section
                    key={section.title}
                    title={section.title}
                    accounts={rows}
                    currency={currency}
                  />
                )
              })}
              {closed.length > 0 && (
                <section className="flex flex-col">
                  <button
                    type="button"
                    aria-expanded={showClosed}
                    onClick={() => setShowClosed(!showClosed)}
                    className="flex h-9 items-center gap-1 self-start rounded-md pr-2 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <ChevronDownIcon
                      className={cn(
                        "size-4 transition-transform",
                        !showClosed && "-rotate-90"
                      )}
                    />
                    Closed ({closed.length})
                  </button>
                  {showClosed && (
                    <div className="flex flex-col">
                      {byName(closed).map((a) => (
                        <AccountRow
                          key={a.id}
                          account={a}
                          currency={currency}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )
        }}
      </QueryState>
      <AddAccountDialog step={add} onStepChange={onAddChange} />
    </Page>
  )
}

function byName(accounts: Account[]): Account[] {
  return [...accounts].sort((a, b) => a.name.localeCompare(b.name))
}

function Section({
  title,
  accounts,
  currency,
}: {
  title: string
  accounts: Account[]
  currency: string
}) {
  const sum = total(accounts)
  return (
    <section className="flex flex-col">
      <div className="flex h-9 items-center justify-between border-b px-3 text-sm font-medium">
        <h2>{title}</h2>
        <span className="tabular-nums">
          {formatMoney(sum ?? knownTotal(accounts), currency, {
            symbol: false,
          })}
        </span>
      </div>
      <div className="flex flex-col">
        {accounts.map((a) => (
          <AccountRow key={a.id} account={a} currency={currency} />
        ))}
      </div>
    </section>
  )
}

function AccountRow({
  account,
  currency,
}: {
  account: Account
  currency: string
}) {
  const foreign = account.currency !== currency
  return (
    <Link
      to="/accounts/$id"
      params={{ id: String(account.id) }}
      className={cn(
        "flex min-h-14 items-center gap-4 rounded-lg px-3 py-2 text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50",
        account.closed && "text-muted-foreground"
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{account.name}</span>
        <span className="truncate text-muted-foreground">
          <ConnectionState account={account} />
        </span>
      </span>
      <span className="flex flex-col items-end tabular-nums">
        <span>
          {formatMoney(account.balance, account.currency, { symbol: foreign })}
        </span>
        {foreign && account.budgetBalance !== null && (
          <span className="text-muted-foreground">
            ≈ {formatMoney(account.budgetBalance, currency, { whole: true })}
          </span>
        )}
      </span>
    </Link>
  )
}
