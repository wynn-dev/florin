// Settings › Connections › Interactive Brokers: titles and controls, with only
// the state the person needs now (an error, sections the query lacks) shown
// beyond them. The section heading is the Settings page's.
import { Fragment, useState } from "react"
import { ConnectIbkrDialog, CredentialsDialog } from "./connect-ibkr-dialog"
import {
  useDisconnectIbkr,
  useIbkrStatus,
  usePullIbkr,
  useUntil,
} from "./use-ibkr"
import type { ReactNode } from "react"
import type { IbkrStatus } from "@/shared/ibkr"
import { formatDate, getLocale } from "@/lib/format"
import { Money } from "@/components/money"
import { SectionError, SkeletonRows } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Field, FieldTitle } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"

/** "11 Nov, 06:10" in the person's locale and time zone. */
function reportTime(iso: string): string {
  return new Intl.DateTimeFormat(getLocale(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso))
}

function clockTime(iso: string): string {
  return new Intl.DateTimeFormat(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso))
}

function Row({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <Field orientation="horizontal" className="min-h-9 justify-between">
      {title !== undefined && (
        <FieldTitle className="font-normal">{title}</FieldTitle>
      )}
      <div className="ml-auto flex min-w-0 items-center justify-end gap-3 text-sm">
        {children}
      </div>
    </Field>
  )
}

function Rows({ children }: { children: ReactNode[] }) {
  const rows = children.filter(Boolean)
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 && <Separator />}
          {row}
        </Fragment>
      ))}
    </div>
  )
}

export function IbkrSettings() {
  const status = useIbkrStatus()
  if (status.isPending) return <SkeletonRows rows={3} />
  if (status.isError)
    return (
      <SectionError
        onRetry={() => void status.refetch()}
        retrying={status.isFetching}
      />
    )
  return status.data.configured ? (
    <Connected status={status.data} />
  ) : (
    <NotConnected status={status.data} />
  )
}

function NotConnected({ status }: { status: IbkrStatus }) {
  const [open, setOpen] = useState(false)
  return (
    <Rows>
      <Row title="Flex token">
        <span className="text-muted-foreground">Not set</span>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Connect
        </Button>
      </Row>
      {status.accounts.length > 0 && <AccountRows status={status} />}
      <ConnectIbkrDialog open={open} onOpenChange={setOpen} />
    </Rows>
  )
}

function Connected({ status }: { status: IbkrStatus }) {
  const [change, setChange] = useState<"token" | "query" | null>(null)
  const pull = usePullIbkr()
  const disconnect = useDisconnectIbkr()
  const waiting = useUntil(status.nextPullAllowedAt)
  const running = status.running || pull.isPending
  // A refused pull (IBKR's limit) isn't stored as the connection's error; show it here.
  const pullError =
    pull.isError && pull.error.message !== status.lastError
      ? pull.error.message
      : null

  return (
    <Rows>
      <Row title="Flex token">
        <span className="text-muted-foreground">
          Set
          {status.token.setAt &&
            ` · added ${formatDate(status.token.setAt.slice(0, 10))}`}
        </span>
        <Button variant="outline" size="sm" onClick={() => setChange("token")}>
          Change
        </Button>
      </Row>
      <Row title="Query ID">
        <span className="tabular-nums">{status.queryId}</span>
        <Button variant="outline" size="sm" onClick={() => setChange("query")}>
          Change
        </Button>
      </Row>
      <AccountRows status={status} />
      <Row
        title={
          status.lastReportAt
            ? `Last report ${reportTime(status.lastReportAt)}`
            : "No report yet"
        }
      >
        {running ? (
          <span className="text-muted-foreground">Pulling…</span>
        ) : (
          waiting &&
          status.nextPullAllowedAt && (
            <span className="text-muted-foreground">
              Next pull allowed at {clockTime(status.nextPullAllowedAt)}
            </span>
          )
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={running || waiting}
          onClick={() => pull.mutate()}
        >
          {running && <Spinner />}
          Pull now
        </Button>
      </Row>
      {(status.lastError || pullError) && (
        <p role="alert" className="text-sm text-negative">
          {pullError ?? status.lastError}
        </p>
      )}
      {status.missingSections.length > 0 && (
        <p className="text-sm text-warning">
          The Flex query lacks {listText(status.missingSections)}. Tick{" "}
          {status.missingSections.length === 1 ? "it" : "them"} in IBKR's Flex
          query so florin gets everything.
        </p>
      )}
      <Row>
        <Button
          variant="ghost"
          size="sm"
          disabled={disconnect.isPending || running}
          onClick={() => disconnect.mutate()}
        >
          Disconnect
        </Button>
      </Row>
      {change && (
        <CredentialsDialog
          open
          onOpenChange={(open) => !open && setChange(null)}
          change={change}
          queryId={status.queryId ?? ""}
        />
      )}
    </Rows>
  )
}

function AccountRows({ status }: { status: IbkrStatus }) {
  return (
    <div className="flex flex-col gap-3">
      {status.accounts.map((a, i) => (
        <Fragment key={a.id}>
          {i > 0 && <Separator />}
          <Row
            title={
              <a href={`/accounts/${a.id}`} className="hover:underline">
                {a.name}
              </a>
            }
          >
            <span className="text-muted-foreground">{a.maskedId}</span>
            {a.value !== null && (
              <Money cents={a.value} currency={a.currency} />
            )}
          </Row>
        </Fragment>
      ))}
    </div>
  )
}

function listText(items: string[]): string {
  if (items.length < 2) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}
