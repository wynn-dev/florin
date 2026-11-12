import { Fragment, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import { ConnectBankDialog } from "./connect-bank-dialog"
import { CopyField } from "./copy-field"
import { CredentialsForm } from "./credentials-form"
import {
  describeSync,
  disconnectLink,
  ebQueries,
  renewLink,
  setSyncHours,
  syncLink,
} from "./api"
import type { BankLink, SyncHours } from "@/shared/enablebanking"
import { cn } from "@/lib/utils"
import { formatDate, formatDateTime, formatRelative } from "@/lib/format"
import { SectionError, SkeletonRows } from "@/components/states"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel, FieldTitle } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const INTERVALS: { hours: SyncHours; label: string }[] = [
  { hours: 6, label: "Every 6 hours" },
  { hours: 12, label: "Every 12 hours" },
  { hours: 24, label: "Daily" },
]

/** "added 12 Nov" from an ISO timestamp. */
const added = (iso: string | null) =>
  iso ? `added ${formatDate(iso.slice(0, 10))}` : ""

function Row({
  title,
  htmlFor,
  children,
}: {
  title: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <Field orientation="horizontal" className="min-h-10 justify-between gap-4">
      {htmlFor ? (
        <FieldLabel htmlFor={htmlFor} className="shrink-0 whitespace-nowrap">
          {title}
        </FieldLabel>
      ) : (
        <FieldTitle className="shrink-0 whitespace-nowrap">{title}</FieldTitle>
      )}
      <div className="flex min-w-0 items-center justify-end gap-3 text-sm">
        {children}
      </div>
    </Field>
  )
}

/**
 * Settings › Connections › Enable Banking: the application id and private
 * key (shown only as set, never their values), the redirect URL to register,
 * the sync interval and every linked bank with Renew and Disconnect. Its own
 * queries and mutations; mount it under an "Enable Banking" heading.
 */
export function EnableBankingSettings() {
  const queryClient = useQueryClient()
  const status = useQuery(ebQueries.status())
  const [editing, setEditing] = useState<
    "appId" | "privateKey" | "both" | null
  >(null)
  const [connecting, setConnecting] = useState(false)
  const interval = useMutation({
    mutationFn: setSyncHours,
    onSuccess: (s) => queryClient.setQueryData(ebQueries.status().queryKey, s),
    onError: (e) => toast.error(e.message),
  })

  if (status.isPending) return <SkeletonRows rows={5} />
  if (status.error)
    return (
      <SectionError
        onRetry={() => void status.refetch()}
        retrying={status.isFetching}
      />
    )
  const s = status.data
  const app = s.application
  const ready = s.appId.set && s.privateKey.set

  return (
    <div className="flex flex-col gap-3">
      <Row title="Application ID">
        {s.appId.set && <span className="text-muted-foreground">Set</span>}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditing(s.privateKey.set ? "appId" : "both")}
        >
          {s.appId.set ? "Change" : "Add"}
        </Button>
      </Row>
      <Separator />
      <Row title="Private key">
        {s.privateKey.set && (
          <span className="text-muted-foreground">
            Set · {added(s.privateKey.setAt)}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditing(s.appId.set ? "privateKey" : "both")}
        >
          {s.privateKey.set ? "Replace" : "Add"}
        </Button>
      </Row>
      {ready && (
        <>
          <Separator />
          <Row title="Application">
            {app ? (
              <span className="truncate text-muted-foreground">
                {app.name} ·{" "}
                {app.environment === "SANDBOX" ? "Sandbox" : "Production"}
                {!app.active && " · inactive"}
              </span>
            ) : (
              <span className="text-negative">{s.applicationError}</span>
            )}
          </Row>
        </>
      )}
      <Separator />
      <Row title="Register this URL in Enable Banking" htmlFor="eb-redirect">
        {app && !app.redirectRegistered && (
          <span className="shrink-0 text-warning">Not registered</span>
        )}
        <CopyField
          id="eb-redirect"
          value={s.redirectUrl}
          className="w-[26rem] min-w-0 shrink"
        />
      </Row>
      <Separator />
      <Row title="Sync" htmlFor="eb-interval">
        <Select
          value={String(s.syncHours)}
          onValueChange={(v) => interval.mutate(Number(v) as SyncHours)}
        >
          <SelectTrigger id="eb-interval" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {INTERVALS.map((i) => (
              <SelectItem key={i.hours} value={String(i.hours)}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Separator />
      <div className="flex flex-col gap-3 pt-3">
        <h3 className="text-sm font-medium">Linked banks</h3>
        {s.links.map((link) => (
          <Fragment key={link.id}>
            <LinkRow link={link} />
            <Separator />
          </Fragment>
        ))}
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConnecting(true)}
          >
            Link a bank
          </Button>
        </div>
      </div>

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing === "appId"
                ? "Application ID"
                : editing === "privateKey"
                  ? "Private key"
                  : "Enable Banking application"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <CredentialsForm
              fields={editing}
              onDone={() => setEditing(null)}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConnectBankDialog open={connecting} onOpenChange={setConnecting} />
    </div>
  )
}

function accessText(link: BankLink): { text: string; tone: string } {
  const day = formatDate(link.validUntil.slice(0, 10))
  if (link.state === "revoked")
    return { text: "Access revoked", tone: "text-negative" }
  if (link.state === "expired")
    return { text: `Access ended ${day}`, tone: "text-negative" }
  if (link.state === "expiring")
    return { text: `Access ends ${day}`, tone: "text-warning" }
  return { text: `Access until ${day}`, tone: "text-muted-foreground" }
}

function LinkRow({ link }: { link: BankLink }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [mapping, setMapping] = useState(false)
  const refresh = () => void queryClient.invalidateQueries()
  const sync = useMutation({
    mutationFn: () => syncLink(link.id),
    onSuccess: (r) =>
      r.error
        ? toast.error(r.error)
        : toast(`${link.bank}: ${describeSync(r).toLowerCase()}`),
    onError: (e) => toast.error(e.message),
    onSettled: refresh,
  })
  const renew = useMutation({
    mutationFn: () => renewLink(link.id),
    onError: (e) => toast.error(e.message),
  })
  const disconnect = useMutation({
    mutationFn: () => disconnectLink(link.id),
    onError: (e) => toast.error(e.message),
    onSettled: refresh,
  })
  const linked = link.accounts.filter((a) => a.accountName)
  const unlinked = link.accounts.length - linked.length
  const access = accessText(link)
  const syncing = sync.isPending || link.syncing

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span className="font-medium">{link.bank}</span>
        <span className="truncate text-muted-foreground">
          {linked.length
            ? linked.map((a) => a.accountName).join(", ")
            : "No accounts linked"}
          {unlinked > 0 && linked.length > 0 && ` · ${unlinked} not linked`}
        </span>
        <span className={access.tone}>{access.text}</span>
        {link.lastError &&
          link.state !== "expired" &&
          link.state !== "revoked" && (
            <span className="text-negative">{link.lastError}</span>
          )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {unlinked > 0 && (
          <Button variant="outline" size="sm" onClick={() => setMapping(true)}>
            Choose accounts
          </Button>
        )}
        {linked.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Sync ${link.bank} now`}
                disabled={
                  syncing ||
                  link.state === "expired" ||
                  link.state === "revoked"
                }
                onClick={() => sync.mutate()}
              >
                {syncing ? <Spinner /> : <RefreshCwIcon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {link.lastSyncAt ? (
                <span title={formatDateTime(link.lastSyncAt)}>
                  Synced {formatRelative(link.lastSyncAt)} · Sync now
                </span>
              ) : (
                "Sync now"
              )}
            </TooltipContent>
          </Tooltip>
        )}
        <Button
          variant={link.state === "active" ? "ghost" : "outline"}
          size="sm"
          disabled={renew.isPending}
          onClick={() => renew.mutate()}
          className={cn(link.state === "active" && "text-muted-foreground")}
        >
          {renew.isPending && <Spinner />}
          Renew
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={disconnect.isPending}
          onClick={() => setConfirming(true)}
        >
          Disconnect
        </Button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {link.bank}?</AlertDialogTitle>
            <AlertDialogDescription>
              florin stops syncing it and ends its access at Enable Banking. Its
              accounts keep their transactions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => disconnect.mutate()}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {mapping && (
        <ConnectBankDialog
          open={mapping}
          onOpenChange={setMapping}
          linkId={link.id}
        />
      )}
    </div>
  )
}
