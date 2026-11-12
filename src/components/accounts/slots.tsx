// Slots for pieces other writers build, each with a plain fallback until
// theirs is on main. The final wiring pass replaces each body with theirs:
// - AccountRegister → <TransactionsTable accountId /> (components/transactions)
// - ImportCsvSlot → <ImportCsvDialog accountId /> (components/transactions)
// - ConnectBankSlot → ConnectBankDialog (components/connections/enable-banking)
// - the Enable Banking branch of ConnectionLine and ConnectionState
//   (connection.tsx) → that connector's status, with Sync now
import { useQuery } from "@tanstack/react-query"
import type { Account } from "@/shared/types"
import { cn } from "@/lib/utils"
import { queries } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { Money } from "@/components/money"
import { EmptyState, QueryState, SkeletonRows } from "@/components/states"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const CONNECTIONS = "/settings?section=connections"

/** An account's transactions with a running balance; read-only until the shared table lands. */
export function AccountRegister({ account }: { account: Account }) {
  const page = useQuery(
    queries.transactions({ accountId: account.id, limit: 200 })
  )
  return (
    <QueryState
      query={page}
      skeleton={<SkeletonRows rows={10} />}
      error="Couldn't load transactions."
    >
      {(data) => {
        if (data.items.length === 0)
          return <EmptyState title="No transactions yet" />
        let running = account.balance
        const rows = data.items.map((t) => {
          const balance = running
          running -= t.amount
          return { ...t, balance }
        })
        return (
          <div role="table" className="text-sm">
            <div
              role="row"
              className="grid h-9 grid-cols-[4rem_minmax(0,1fr)_6.5rem] items-center gap-x-4 border-b px-2 text-xs font-medium text-muted-foreground md:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)_7rem_7rem]"
            >
              <span>Date</span>
              <span>Payee</span>
              <span className="hidden md:block">Category</span>
              <span className="text-right">Amount</span>
              <span className="hidden text-right md:block">Balance</span>
            </div>
            {rows.map((t) => (
              <div
                key={t.id}
                role="row"
                className={cn(
                  "grid h-10 grid-cols-[4rem_minmax(0,1fr)_6.5rem] items-center gap-x-4 border-b px-2 hover:bg-muted/50 md:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)_7rem_7rem]",
                  t.status === "pending" && "text-muted-foreground"
                )}
              >
                <span className="tabular-nums">
                  {t.status === "pending" ? "Pending" : formatDate(t.date)}
                </span>
                <span className="truncate">
                  {t.transferAccountName
                    ? `Transfer ${t.amount < 0 ? "to" : "from"} ${t.transferAccountName}`
                    : (t.payeeName ?? t.importedPayee ?? "")}
                </span>
                <span className="hidden truncate md:block">
                  {t.categoryName}
                </span>
                <Money
                  cents={t.amount}
                  currency={account.currency}
                  symbol={false}
                  signed
                  className="text-right"
                />
                <Money
                  cents={t.balance}
                  currency={account.currency}
                  symbol={false}
                  className="hidden text-right text-muted-foreground md:block"
                />
              </div>
            ))}
          </div>
        )
      }}
    </QueryState>
  )
}

function SettingsPointer({
  open,
  onOpenChange,
  title,
  line,
  hash,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  line: string
  hash: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{line}</p>
        <DialogFooter>
          <Button asChild>
            <a href={`${CONNECTIONS}#${hash}`}>Open Settings</a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Connect a bank through Enable Banking, optionally into an existing account. */
export function ConnectBankSlot(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId?: number
}) {
  return (
    <SettingsPointer
      {...props}
      title="Connect a bank"
      line="Bank connections are set up in Settings › Connections."
      hash="enable-banking"
    />
  )
}

/** Import a CSV file into this account. */
export function ImportCsvSlot({
  open,
  onOpenChange,
  accountId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: number
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import CSV</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          CSV files are imported from Transactions › Import.
        </p>
        <DialogFooter>
          <Button asChild>
            <a href={`/transactions?accountId=${accountId}`}>
              Open Transactions
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
