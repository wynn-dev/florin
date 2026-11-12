// An account's connection state: the line under its balance (with Pull now
// or Sync now) and the second line of its row in the list. Interactive
// Brokers reads its connector's status, a bank account its Enable Banking
// link's: access, last sync, last error, with Sync now and Renew.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Account } from "@/shared/types"
import type { BankLink } from "@/shared/enablebanking"
import type { IbkrStatus } from "@/shared/ibkr"
import { cn } from "@/lib/utils"
import { formatDate, formatDateTime, formatRelative } from "@/lib/format"
import {
  describeSync,
  ebQueries,
  renewLink,
  syncLink,
} from "@/components/connections/enable-banking/api"
import {
  useIbkrStatus,
  usePullIbkr,
  useUntil,
} from "@/components/connections/ibkr/use-ibkr"
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const IBKR_SETTINGS = "/settings?section=connections#ibkr"

function Relative({ iso, prefix }: { iso: string; prefix: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          {prefix} {formatRelative(iso)}
        </span>
      </TooltipTrigger>
      <TooltipContent>{formatDateTime(iso)}</TooltipContent>
    </Tooltip>
  )
}

/** The fix for a failed pull: the token when that's what failed, else Settings. */
function IbkrFix({ status }: { status: IbkrStatus }) {
  return (
    <a
      href={IBKR_SETTINGS}
      className="font-medium underline underline-offset-4"
    >
      {/token/i.test(status.lastError ?? "") ? "Update token" : "Open settings"}
    </a>
  )
}

/** "Interactive Brokers · pulled 2 hr ago · Pull now", or the error and its fix. */
function IbkrLine({ className }: { className?: string }) {
  const status = useIbkrStatus().data
  const pull = usePullIbkr()
  const waiting = useUntil(status?.nextPullAllowedAt)
  const running = pull.isPending || status?.running
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground",
        className
      )}
    >
      <span>Interactive Brokers</span>
      {status?.lastPullAt && !status.lastError && (
        <>
          <span aria-hidden>·</span>
          <Relative iso={status.lastPullAt} prefix="pulled" />
        </>
      )}
      {status?.lastError && (
        <>
          <span aria-hidden>·</span>
          <span className="text-negative">
            {status.lastError} · <IbkrFix status={status} />
          </span>
        </>
      )}
      {status?.configured && (
        <>
          <span aria-hidden>·</span>
          {running ? (
            <span className="flex items-center gap-1.5">
              <Spinner className="size-3.5" />
              Pulling
            </span>
          ) : waiting && status.nextPullAllowedAt ? (
            <Relative
              iso={status.nextPullAllowedAt}
              prefix="next pull allowed"
            />
          ) : (
            <Button
              variant="link"
              className="h-auto p-0 text-sm text-foreground"
              onClick={() => pull.mutate()}
            >
              Pull now
            </Button>
          )}
        </>
      )}
    </p>
  )
}

/** The line under an account's balance: "Manual account", or its connection. */
export function ConnectionLine({
  account,
  className,
}: {
  account: Account
  className?: string
}) {
  if (account.provider === "ibkr") return <IbkrLine className={className} />
  if (account.provider === "enablebanking")
    return <BankLine account={account} className={className} />
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      Manual account
      {account.closed && " · Closed"}
    </p>
  )
}

/** The list row's second line: "Manual", "Nordea · synced 2 hr ago", or what needs the person. */
export function ConnectionState({ account }: { account: Account }) {
  if (account.provider === "ibkr") return <IbkrState />
  if (account.provider === "enablebanking")
    return <BankState accountId={account.id} />
  return <>Manual</>
}

function IbkrState() {
  const status = useIbkrStatus().data
  if (status?.lastError)
    return <span className="text-negative">IBKR report failed</span>
  if (status?.lastPullAt)
    return <>Interactive Brokers · pulled {formatRelative(status.lastPullAt)}</>
  return <>Interactive Brokers</>
}

/** The Enable Banking link feeding this account, if any. */
function useBankLink(accountId: number): BankLink | undefined {
  const links = useQuery(ebQueries.links()).data
  return links?.find((l) => l.accounts.some((a) => a.accountId === accountId))
}

function inDays(n: number): string {
  return n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`
}

function BankState({ accountId }: { accountId: number }) {
  const link = useBankLink(accountId)
  if (!link) return <>Enable Banking</>
  if (link.state === "revoked")
    return <span className="text-negative">Bank access revoked</span>
  if (link.state === "expired")
    return <span className="text-negative">Bank access ended</span>
  if (link.lastError)
    return <span className="text-negative">Bank sync failed</span>
  if (link.state === "expiring")
    return (
      <span className="text-warning">Access ends {inDays(link.daysLeft)}</span>
    )
  return (
    <>
      {link.bank}
      {link.lastSyncAt && <> · synced {formatRelative(link.lastSyncAt)}</>}
    </>
  )
}

/**
 * "Nordea · synced 12 min ago · Sync now"; the last sync's error with Retry;
 * "Access ends in 5 days · Renew" once the end is near; and once access has
 * ended, an alert that says what stops, with Renew access.
 */
function BankLine({
  account,
  className,
}: {
  account: Account
  className?: string
}) {
  const link = useBankLink(account.id)
  const client = useQueryClient()
  const sync = useMutation({
    mutationFn: (id: number) => syncLink(id),
    onSuccess: (r) =>
      r.error
        ? toast.error(r.error)
        : toast(`${link?.bank}: ${describeSync(r).toLowerCase()}`),
    onError: (e) => toast.error(e.message),
    onSettled: () => client.invalidateQueries(),
  })
  const renew = useMutation({
    mutationFn: (id: number) => renewLink(id),
    onError: (e) => toast.error(e.message),
  })
  const line = cn(
    "flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground",
    className
  )
  if (!link)
    return <p className={line}>Enable Banking{account.closed && " · Closed"}</p>

  const syncing = sync.isPending || link.syncing
  const linkButton = (label: string, onClick: () => void, busy = false) => (
    <Button
      variant="link"
      className="h-auto p-0 text-sm text-foreground"
      disabled={busy}
      onClick={onClick}
    >
      {busy && <Spinner className="size-3.5" />}
      {label}
    </Button>
  )

  if (link.state === "expired" || link.state === "revoked") {
    return (
      <>
        <p className={line}>
          <span>{link.bank}</span>
          {link.lastSyncAt && (
            <>
              <span aria-hidden>·</span>
              <Relative iso={link.lastSyncAt} prefix="last synced" />
            </>
          )}
        </p>
        <Alert className="mt-3 pr-36">
          <AlertDescription className="text-foreground">
            {link.state === "revoked"
              ? `${link.bank} revoked florin's access.`
              : `Bank access ended on ${formatDate(link.validUntil.slice(0, 10))}.`}{" "}
            New transactions won&rsquo;t arrive until you renew it.
          </AlertDescription>
          <AlertAction className="top-1/2 -translate-y-1/2">
            <Button
              size="sm"
              disabled={renew.isPending}
              onClick={() => renew.mutate(link.id)}
            >
              {renew.isPending && <Spinner />}
              Renew access
            </Button>
          </AlertAction>
        </Alert>
      </>
    )
  }

  return (
    <p className={line}>
      <span>{link.bank}</span>
      {link.lastError ? (
        <>
          <span aria-hidden>·</span>
          <span className="text-negative">{link.lastError}</span>
          <span aria-hidden>·</span>
          {linkButton("Retry", () => sync.mutate(link.id), syncing)}
        </>
      ) : syncing ? (
        <>
          <span aria-hidden>·</span>
          <span className="flex items-center gap-1.5">
            <Spinner className="size-3.5" />
            Syncing
          </span>
        </>
      ) : (
        <>
          {link.lastSyncAt && (
            <>
              <span aria-hidden>·</span>
              <Relative iso={link.lastSyncAt} prefix="synced" />
            </>
          )}
          <span aria-hidden>·</span>
          {linkButton("Sync now", () => sync.mutate(link.id))}
        </>
      )}
      {link.state === "expiring" && (
        <>
          <span aria-hidden>·</span>
          <span className="text-warning">
            Access ends {inDays(link.daysLeft)}
          </span>
          <span aria-hidden>·</span>
          {linkButton("Renew", () => renew.mutate(link.id), renew.isPending)}
        </>
      )}
    </p>
  )
}
