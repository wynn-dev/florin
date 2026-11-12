// An account's connection state: the line under its balance (with Pull now
// or Sync now) and the second line of its row in the list. Interactive
// Brokers reads its connector's status; Enable Banking stays a plain label
// until that connector's status lands (see slots.tsx).
import type { Account } from "@/shared/types"
import type { IbkrStatus } from "@/shared/ibkr"
import { cn } from "@/lib/utils"
import { formatDateTime, formatRelative } from "@/lib/format"
import {
  useIbkrStatus,
  usePullIbkr,
  useUntil,
} from "@/components/connections/ibkr/use-ibkr"
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
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      {account.provider === "enablebanking"
        ? "Enable Banking"
        : "Manual account"}
      {account.closed && " · Closed"}
    </p>
  )
}

/** The list row's second line: "Manual", "Interactive Brokers · pulled 2 hr ago", or what failed. */
export function ConnectionState({ account }: { account: Account }) {
  if (account.provider === "ibkr") return <IbkrState />
  return (
    <>{account.provider === "enablebanking" ? "Enable Banking" : "Manual"}</>
  )
}

function IbkrState() {
  const status = useIbkrStatus().data
  if (status?.lastError)
    return <span className="text-negative">IBKR report failed</span>
  if (status?.lastPullAt)
    return <>Interactive Brokers · pulled {formatRelative(status.lastPullAt)}</>
  return <>Interactive Brokers</>
}
