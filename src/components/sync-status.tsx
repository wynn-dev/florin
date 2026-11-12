// The one global place sync state shows: a line in the sidebar footer (and in
// the phone's ⋯ menu) that opens a popover listing each connection with its
// last sync, its state and Sync now / Renew. It reads the connectors' own
// status endpoints; with nothing connected there is no line at all.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouterState } from "@tanstack/react-router"
import { toast } from "sonner"
import { ApiError, api } from "@/lib/api"
import { formatDateTime, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// The parts of the connectors' status answers this reads
// (src/shared/enablebanking.ts, src/shared/ibkr.ts).
type BankLink = {
  id: number
  bank: string
  state: "active" | "expiring" | "expired" | "revoked"
  validUntil: string | null
  daysLeft: number | null
  lastSyncAt: string | null
  lastError: string | null
  syncing: boolean
}
type EnableBankingStatus = { links: BankLink[] }
type IbkrStatus = {
  configured: boolean
  lastPullAt: string | null
  lastError: string | null
  running: boolean
  nextPullAllowedAt: string | null
}

/** A connector's status, or null when it isn't part of this florin (404). */
async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export type Connection = {
  key: string
  name: string
  lastSyncAt: string | null
  syncing: boolean
  /** What's wrong or about to be, in a few words; null when all is well. */
  problem: string | null
  tone: "ok" | "warning" | "negative"
  action: "sync" | "renew"
  /** When the action can't run yet, why: "Next at 14:20". */
  wait: string | null
  run: () => Promise<unknown>
}

const EB_KEY = ["enable-banking"]
const IBKR_KEY = ["connections", "ibkr"]

/** Each connection florin has, from the connectors' status endpoints. */
export function useConnections() {
  const bank = useQuery({
    queryKey: EB_KEY,
    queryFn: () => optional<EnableBankingStatus>("/connections/enable-banking"),
    refetchInterval: (q) =>
      q.state.data?.links.some((l) => l.syncing) ? 2_000 : 60_000,
  })
  const ibkr = useQuery({
    queryKey: IBKR_KEY,
    queryFn: () => optional<IbkrStatus>("/connections/ibkr"),
    refetchInterval: (q) => (q.state.data?.running ? 2_000 : 60_000),
  })
  const returnTo = useRouterState({ select: (s) => s.location.href })

  const connections: Connection[] = []
  for (const link of bank.data?.links ?? []) {
    if (link.state === "revoked") continue
    const ended = link.state === "expired"
    const ending =
      !ended && link.daysLeft !== null && link.daysLeft <= 7
        ? link.daysLeft
        : null
    connections.push({
      key: `bank-${link.id}`,
      name: link.bank,
      lastSyncAt: link.lastSyncAt,
      syncing: link.syncing,
      problem: ended
        ? "Access ended"
        : ending !== null
          ? ending <= 0
            ? "Access ends today"
            : `Access ends in ${ending} ${ending === 1 ? "day" : "days"}`
          : link.lastError
            ? `Sync failed: ${link.lastError}`
            : null,
      tone:
        ended || link.lastError
          ? "negative"
          : ending !== null
            ? "warning"
            : "ok",
      action: ended || ending !== null ? "renew" : "sync",
      wait: null,
      run:
        ended || ending !== null
          ? async () => {
              const { url } = await api<{ url: string }>(
                `/connections/enable-banking/links/${link.id}/renew`,
                { method: "POST", body: { returnTo } }
              )
              window.location.href = url
            }
          : () =>
              api(`/connections/enable-banking/links/${link.id}/sync`, {
                method: "POST",
              }),
    })
  }
  if (ibkr.data?.configured) {
    const next = ibkr.data.nextPullAllowedAt
    connections.push({
      key: "ibkr",
      name: "Interactive Brokers",
      lastSyncAt: ibkr.data.lastPullAt,
      syncing: ibkr.data.running,
      problem: ibkr.data.lastError
        ? `Report failed: ${ibkr.data.lastError}`
        : null,
      tone: ibkr.data.lastError ? "negative" : "ok",
      action: "sync",
      wait:
        next && new Date(next) > new Date()
          ? `Next at ${formatDateTime(next).split(", ").at(-1)}`
          : null,
      run: () => api("/connections/ibkr/pull", { method: "POST" }),
    })
  }
  return connections
}

/** The footer line's state: syncing, the worst problem, or the oldest sync. */
export function syncSummary(connections: Connection[]): {
  text: string
  tone: Connection["tone"]
  syncing: boolean
  at: string | null
} | null {
  if (!connections.length) return null
  if (connections.some((c) => c.syncing))
    return { text: "Syncing…", tone: "ok", syncing: true, at: null }
  const worst =
    connections.find((c) => c.tone === "negative") ??
    connections.find((c) => c.tone === "warning")
  if (worst) {
    const text =
      worst.action === "renew"
        ? `${worst.name} ${worst.problem!.charAt(0).toLowerCase()}${worst.problem!.slice(1)}`
        : `${worst.name} sync failed`
    return { text, tone: worst.tone, syncing: false, at: null }
  }
  const times = connections
    .map((c) => c.lastSyncAt)
    .filter((t): t is string => !!t)
    .sort()
  const oldest = times[0] ?? null
  return {
    text: oldest ? `Synced ${formatRelative(oldest)}` : "Not synced yet",
    tone: "ok",
    syncing: false,
    at: oldest,
  }
}

export function StatusDot({ tone }: { tone: Connection["tone"] }) {
  if (tone === "ok") return null
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        tone === "warning" ? "bg-warning" : "bg-negative"
      )}
    />
  )
}

/** Every connection with its state and its one action. */
export function ConnectionList({ connections }: { connections: Connection[] }) {
  return (
    <ul className="flex flex-col">
      {connections.map((c) => (
        <ConnectionRow key={c.key} connection={c} />
      ))}
    </ul>
  )
}

function ConnectionRow({ connection: c }: { connection: Connection }) {
  const queryClient = useQueryClient()
  const run = useMutation({
    mutationFn: c.run,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: EB_KEY })
      void queryClient.invalidateQueries({ queryKey: IBKR_KEY })
    },
    onError: (error) =>
      toast.error(error.message, {
        action: { label: "Retry", onClick: () => run.mutate() },
      }),
  })
  const busy = c.syncing || run.isPending
  return (
    <li className="flex min-h-12 items-center gap-3 py-2 not-last:border-b">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{c.name}</span>
        <span
          className={cn(
            "flex items-center gap-1.5 truncate text-xs",
            c.tone === "ok" && "text-muted-foreground",
            c.tone === "warning" && "text-warning",
            c.tone === "negative" && "text-negative"
          )}
        >
          {c.problem ??
            (busy ? (
              "Syncing…"
            ) : c.lastSyncAt ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>Synced {formatRelative(c.lastSyncAt)}</span>
                </TooltipTrigger>
                <TooltipContent>{formatDateTime(c.lastSyncAt)}</TooltipContent>
              </Tooltip>
            ) : (
              "Not synced yet"
            ))}
        </span>
      </div>
      {c.wait && !busy && (
        <span className="text-xs text-muted-foreground">{c.wait}</span>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={busy || !!c.wait}
        onClick={() => run.mutate()}
      >
        {busy && <Spinner />}
        {c.action === "renew" ? "Renew" : "Sync now"}
      </Button>
    </li>
  )
}
