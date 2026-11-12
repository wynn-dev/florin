// Connecting Interactive Brokers: the Flex token and query id, checked with a
// real pull before florin keeps them, then the account(s) the report holds.
// Used by Accounts › Add account and first-run setup (ConnectIbkrDialog) and
// by Settings › Connections to change the token or query id (CredentialsDialog).
import { useState } from "react"
import { useIbkrStatus, useSaveIbkr } from "./use-ibkr"
import type { IbkrAccount } from "@/shared/ibkr"
import { formatDate } from "@/lib/format"
import { Money } from "@/components/money"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void }

/** Accounts › Add account › Connect Interactive Brokers. */
export function ConnectIbkrDialog({ open, onOpenChange }: DialogProps) {
  const status = useIbkrStatus()
  const [connected, setConnected] = useState<IbkrAccount[] | null>(null)
  const close = (next: boolean) => {
    if (!next) setConnected(null)
    onOpenChange(next)
  }
  const accounts =
    connected ??
    (status.data?.configured && status.data.accounts.length
      ? status.data.accounts
      : null)
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Interactive Brokers</DialogTitle>
        </DialogHeader>
        {accounts ? (
          <>
            <AccountList accounts={accounts} onOpen={() => close(false)} />
            <DialogFooter>
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <CredentialsForm
            askToken
            initialQueryId={status.data?.queryId ?? ""}
            submitLabel="Connect"
            onSaved={(s) => setConnected(s.accounts)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Settings › Connections: change the token, or the query id. */
export function CredentialsDialog({
  open,
  onOpenChange,
  change,
  queryId,
}: DialogProps & { change: "token" | "query"; queryId: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {change === "token" ? "Change Flex token" : "Change query ID"}
          </DialogTitle>
        </DialogHeader>
        <CredentialsForm
          askToken={change === "token"}
          initialQueryId={queryId}
          submitLabel="Save"
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function CredentialsForm({
  askToken,
  initialQueryId,
  submitLabel,
  onSaved,
}: {
  askToken: boolean
  initialQueryId: string
  submitLabel: string
  onSaved: (
    status: NonNullable<ReturnType<typeof useIbkrStatus>["data"]>
  ) => void
}) {
  const [token, setToken] = useState("")
  const [queryId, setQueryId] = useState(initialQueryId)
  const save = useSaveIbkr()
  const ready = queryId.trim() !== "" && (!askToken || token.trim() !== "")
  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready || save.isPending) return
        save.mutate(
          {
            ...(askToken ? { token: token.trim() } : {}),
            queryId: queryId.trim(),
          },
          { onSuccess: onSaved }
        )
      }}
    >
      <FieldGroup className="gap-4">
        {askToken && (
          <Field>
            <FieldLabel htmlFor="ibkr-token">Flex token</FieldLabel>
            <Input
              id="ibkr-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={save.isPending}
              autoFocus
            />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="ibkr-query">Query ID</FieldLabel>
          <Input
            id="ibkr-query"
            inputMode="numeric"
            autoComplete="off"
            value={queryId}
            onChange={(e) => setQueryId(e.target.value)}
            disabled={save.isPending}
            autoFocus={!askToken}
          />
        </Field>
        {save.isError && <FieldError>{save.error.message}</FieldError>}
      </FieldGroup>
      <DialogFooter className="items-center">
        {save.isPending && (
          <span className="mr-auto text-sm text-muted-foreground">
            Pulling the report from IBKR…
          </span>
        )}
        <Button type="submit" disabled={!ready || save.isPending}>
          {save.isPending && <Spinner />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

function AccountList({
  accounts,
  onOpen,
}: {
  accounts: IbkrAccount[]
  onOpen: () => void
}) {
  return (
    <ul className="-my-1 divide-y">
      {accounts.map((a) => (
        <li key={a.id} className="flex items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <a
              href={`/accounts/${a.id}`}
              onClick={onOpen}
              className="font-medium hover:underline"
            >
              {a.name}
            </a>
            <div className="text-muted-foreground">
              {a.maskedId}
              {a.asOf && ` · as of ${formatDate(a.asOf)}`}
            </div>
          </div>
          {a.value !== null && <Money cents={a.value} currency={a.currency} />}
        </li>
      ))}
    </ul>
  )
}
