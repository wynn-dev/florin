import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { MoreHorizontalIcon } from "lucide-react"
import { toast } from "sonner"
import { accountQueries, useDeleteAccount, useUpdateAccount } from "./queries"
import { ConnectBankSlot, ImportCsvSlot } from "./slots"
import { useAfterClose } from "@/hooks/use-after-close"
import type { Account } from "@/shared/types"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"

/**
 * An account's ⋯: Rename, Import CSV, Connect a bank / Disconnect, Close
 * (or Reopen) account, Delete with the transaction count.
 */
export function AccountMenu({ account }: { account: Account }) {
  const [renaming, setRenaming] = useState(false)
  const [dialog, setDialog] = useState<"import" | "connect" | "delete" | null>(
    null
  )
  const update = useUpdateAccount(account.id)
  const after = useAfterClose()
  const investment = account.type === "investment"

  const setClosed = (closed: boolean) =>
    update.mutate(
      { closed },
      {
        onSuccess: () =>
          toast(`${closed ? "Closed" : "Reopened"} ${account.name}`, {
            action: {
              label: "Undo",
              onClick: () => update.mutate({ closed: !closed }),
            },
          }),
      }
    )

  return (
    <>
      <Popover open={renaming} onOpenChange={setRenaming}>
        <DropdownMenu>
          <PopoverAnchor asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${account.name} options`}
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
          </PopoverAnchor>
          <DropdownMenuContent
            align="end"
            className="w-48"
            onCloseAutoFocus={after.onCloseAutoFocus}
          >
            <DropdownMenuItem onSelect={after.later(() => setRenaming(true))}>
              Rename
            </DropdownMenuItem>
            {!investment && (
              <DropdownMenuItem onSelect={() => setDialog("import")}>
                Import CSV
              </DropdownMenuItem>
            )}
            {account.provider ? (
              <DropdownMenuItem asChild>
                <a href="/settings?section=connections">Disconnect</a>
              </DropdownMenuItem>
            ) : (
              !investment && (
                <DropdownMenuItem onSelect={() => setDialog("connect")}>
                  Connect a bank
                </DropdownMenuItem>
              )
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setClosed(!account.closed)}>
              {account.closed ? "Reopen account" : "Close account"}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDialog("delete")}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <PopoverContent align="end" className="w-72 p-2">
          <RenameForm
            name={account.name}
            onSave={(name) => {
              setRenaming(false)
              if (name !== account.name) update.mutate({ name })
            }}
          />
        </PopoverContent>
      </Popover>
      <ImportCsvSlot
        open={dialog === "import"}
        onOpenChange={(open) => !open && setDialog(null)}
        accountId={account.id}
      />
      <ConnectBankSlot
        open={dialog === "connect"}
        onOpenChange={(open) => !open && setDialog(null)}
        accountId={account.id}
      />
      <DeleteAccount
        account={account}
        open={dialog === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
      />
    </>
  )
}

function RenameForm({
  name,
  onSave,
}: {
  name: string
  onSave: (name: string) => void
}) {
  const [text, setText] = useState(name)
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim()) onSave(text.trim())
      }}
    >
      <Input
        aria-label="Account name"
        autoFocus
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
      />
      <Button type="submit" disabled={!text.trim()}>
        Save
      </Button>
    </form>
  )
}

function DeleteAccount({
  account,
  open,
  onOpenChange,
}: {
  account: Account
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const count = useQuery({
    ...accountQueries.transactionCount(account.id),
    enabled: open,
  })
  const remove = useDeleteAccount(account.id)
  const navigate = useNavigate()
  const n = count.data
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {account.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {n === undefined
              ? "Its transactions are deleted with it."
              : n === 0
                ? "It has no transactions."
                : `Its ${n} transaction${n === 1 ? " is" : "s are"} deleted with it.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={(e) => {
              e.preventDefault()
              remove.mutate(undefined, {
                onSuccess: () => {
                  onOpenChange(false)
                  toast(`Deleted ${account.name}`)
                  void navigate({ to: "/accounts" })
                },
              })
            }}
          >
            {remove.isPending && <Spinner />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
