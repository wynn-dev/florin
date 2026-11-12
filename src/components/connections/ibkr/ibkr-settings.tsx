// Settings › Connections › Interactive Brokers: titles and controls, with only
// the state the person needs now (an error, sections the query lacks) shown
// beyond them. The section heading is the Settings page's.
import { useState } from "react"
import { ConnectIbkrDialog, CredentialsDialog } from "./connect-ibkr-dialog"
import {
  useDisconnectIbkr,
  useIbkrStatus,
  usePullIbkr,
  useUntil,
} from "./use-ibkr"
import type { IbkrStatus } from "@/shared/ibkr"
import { formatDate, formatDayTime, formatTime } from "@/lib/format"
import { Money } from "@/components/money"
import { Aside, SettingsRow } from "@/components/settings/row"
import { SectionError, SkeletonRows } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/** A line of state under the rows: an error, or sections the query lacks. */
function Note({ tone, children }: { tone: string; children: string }) {
  return (
    <p role="alert" className={`border-b py-3 text-sm ${tone}`}>
      {children}
    </p>
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
    <>
      <SettingsRow title="Flex token">
        <Aside>Not set</Aside>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Connect
        </Button>
      </SettingsRow>
      <AccountRows status={status} />
      <ConnectIbkrDialog open={open} onOpenChange={setOpen} />
    </>
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
    <>
      <SettingsRow title="Flex token">
        <Aside>
          Set
          {status.token.setAt &&
            ` · added ${formatDate(status.token.setAt.slice(0, 10))}`}
        </Aside>
        <Button variant="outline" size="sm" onClick={() => setChange("token")}>
          Change
        </Button>
      </SettingsRow>
      <SettingsRow title="Query ID">
        <Aside>{status.queryId}</Aside>
        <Button variant="outline" size="sm" onClick={() => setChange("query")}>
          Change
        </Button>
      </SettingsRow>
      <AccountRows status={status} />
      <SettingsRow title="Last report">
        <Aside>
          {running
            ? "Pulling…"
            : waiting && status.nextPullAllowedAt
              ? `Next pull allowed at ${formatTime(status.nextPullAllowedAt)}`
              : status.lastReportAt
                ? formatDayTime(status.lastReportAt)
                : "None yet"}
        </Aside>
        <Button
          variant="outline"
          size="sm"
          disabled={running || waiting}
          onClick={() => pull.mutate()}
        >
          {running && <Spinner />}
          Pull now
        </Button>
      </SettingsRow>
      {(status.lastError || pullError) && (
        <Note tone="text-negative">{(pullError ?? status.lastError)!}</Note>
      )}
      {status.missingSections.length > 0 && (
        <Note tone="text-warning">
          {`The Flex query lacks ${listText(status.missingSections)}. Tick ${
            status.missingSections.length === 1 ? "it" : "them"
          } in IBKR's Flex query so florin gets everything.`}
        </Note>
      )}
      <SettingsRow title="Connection">
        <Button
          variant="outline"
          size="sm"
          disabled={disconnect.isPending || running}
          onClick={() => disconnect.mutate()}
        >
          Disconnect
        </Button>
      </SettingsRow>
      {change && (
        <CredentialsDialog
          open
          onOpenChange={(open) => !open && setChange(null)}
          change={change}
          queryId={status.queryId ?? ""}
        />
      )}
    </>
  )
}

function AccountRows({ status }: { status: IbkrStatus }) {
  return status.accounts.map((a) => (
    <SettingsRow
      key={a.id}
      title={
        <a href={`/accounts/${a.id}`} className="hover:underline">
          {a.name}
        </a>
      }
    >
      <Aside>{a.maskedId}</Aside>
      {a.value !== null && (
        <Money cents={a.value} currency={a.currency} className="text-sm" />
      )}
    </SettingsRow>
  ))
}

function listText(items: string[]): string {
  if (items.length < 2) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}
