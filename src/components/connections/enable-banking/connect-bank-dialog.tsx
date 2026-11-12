import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronsUpDownIcon } from "lucide-react"
import { toast } from "sonner"
import { CredentialsForm } from "./credentials-form"
import { CopyField } from "./copy-field"
import { describeSync, ebQueries, mapAccounts, startLink } from "./api"
import type { AccountMapping, BankAccount } from "@/shared/enablebanking"
import { queries } from "@/lib/api"
import { cn } from "@/lib/utils"
import { getLocale } from "@/lib/format"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

// The bank sends the browser back to the page the link started on, with
// ?link=<id> (accounts to map) or ?linkError=<words>. The first dialog
// mounted on that page picks it up and opens itself.
let claimed = false
const RETURN_PARAMS = ["link", "linkError", "linked"]

function useReturnFromBank() {
  const [back, setBack] = useState<{ linkId?: number; error?: string } | null>(
    null
  )
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const link = Number(params.get("link")) || undefined
    const error = params.get("linkError") ?? undefined
    if ((!link && !error) || claimed) return
    claimed = true
    setBack({ linkId: link, error })
    return () => {
      claimed = false
    }
  }, [])
  const clear = () => {
    const url = new URL(window.location.href)
    RETURN_PARAMS.forEach((p) => url.searchParams.delete(p))
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search + url.hash
    )
    setBack(null)
  }
  return { back, clear }
}

/**
 * Connects a bank through Enable Banking: country, then bank, then the bank's
 * own page; back in florin, "Link to which account?" for each bank account.
 * Asks for the Enable Banking credentials first when they aren't set. Keep it
 * mounted on the page that opens it (not only while open), so it can pick up
 * the return from the bank. `accountId` suggests an existing account for the
 * first bank account (from an account's "Connect a bank"); `linkId` opens
 * straight at the mapping of an existing link.
 */
export function ConnectBankDialog({
  open,
  onOpenChange,
  accountId,
  linkId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId?: number
  linkId?: number
}) {
  const { back, clear } = useReturnFromBank()
  const shown = open || back !== null
  const mapping = back?.linkId ?? linkId
  const close = (next: boolean) => {
    if (next) return
    if (back) clear()
    onOpenChange(false)
  }
  return (
    <Dialog open={shown} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        {shown &&
          (mapping !== undefined ? (
            <MapStep
              linkId={mapping}
              accountId={accountId}
              onDone={() => close(false)}
            />
          ) : (
            <ConnectStep error={back?.error} />
          ))}
      </DialogContent>
    </Dialog>
  )
}

function countryName(code: string): string {
  try {
    return (
      new Intl.DisplayNames([getLocale()], { type: "region" }).of(code) ?? code
    )
  } catch {
    return code
  }
}

function ConnectStep({ error }: { error?: string }) {
  const status = useQuery(ebQueries.status())
  const [editing, setEditing] = useState(false)
  const s = status.data
  const needsCredentials = s && (!s.appId.set || !s.privateKey.set)

  if (!s) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Connect a bank</DialogTitle>
        </DialogHeader>
        {status.error ? (
          <Alert variant="destructive">
            <AlertDescription>{status.error.message}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        )}
      </>
    )
  }

  if (needsCredentials || editing) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Connect a bank</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Add your Enable Banking application to link banks.
        </p>
        <CredentialsForm
          fields="both"
          submitLabel="Continue"
          onDone={() => setEditing(false)}
          onCancel={editing ? () => setEditing(false) : undefined}
        />
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Connect a bank</DialogTitle>
      </DialogHeader>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {s.applicationError ? (
        <>
          <Alert variant="destructive">
            <AlertDescription>{s.applicationError}</AlertDescription>
          </Alert>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(true)}>
              Change credentials
            </Button>
          </DialogFooter>
        </>
      ) : s.application && !s.application.redirectRegistered ? (
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel>Register this URL in Enable Banking</FieldLabel>
            <CopyField value={s.redirectUrl} />
          </Field>
          <p className="text-sm text-muted-foreground">
            Add it to your application at enablebanking.com, then come back.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void status.refetch()}
              disabled={status.isFetching}
            >
              {status.isFetching && <Spinner />}
              Check again
            </Button>
          </DialogFooter>
        </FieldGroup>
      ) : (
        <BankPicker
          countries={s.application?.countries ?? []}
          production={s.application?.environment === "PRODUCTION"}
        />
      )}
    </>
  )
}

function defaultCountry(countries: string[]): string {
  const region = new Intl.Locale(navigator.language).maximize().region
  return region && countries.includes(region) ? region : (countries[0] ?? "")
}

function BankPicker({
  countries,
  production,
}: {
  countries: string[]
  production: boolean
}) {
  const sorted = useMemo(
    () =>
      [...countries].sort((a, b) =>
        countryName(a).localeCompare(countryName(b))
      ),
    [countries]
  )
  const [country, setCountry] = useState(() => defaultCountry(countries))
  const [bank, setBank] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const banks = useQuery({ ...ebQueries.banks(country), enabled: !!country })
  const go = useMutation({
    mutationFn: () => startLink(country, bank!),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (bank) go.mutate()
      }}
    >
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="eb-country">Country</FieldLabel>
          <Select
            value={country}
            onValueChange={(c) => {
              setCountry(c)
              setBank(null)
            }}
          >
            <SelectTrigger id="eb-country" className="w-full">
              <SelectValue placeholder="Country" />
            </SelectTrigger>
            <SelectContent>
              {sorted.map((c) => (
                <SelectItem key={c} value={c}>
                  {countryName(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="eb-bank">Bank</FieldLabel>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                id="eb-bank"
                variant="outline"
                role="combobox"
                aria-expanded={open}
                disabled={!country}
                className="w-full justify-between font-normal"
              >
                <span
                  className={cn("truncate", !bank && "text-muted-foreground")}
                >
                  {bank ?? "Choose your bank"}
                </span>
                {banks.isFetching ? (
                  <Spinner className="text-muted-foreground" />
                ) : (
                  <ChevronsUpDownIcon className="text-muted-foreground" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-(--radix-popover-trigger-width) p-0"
            >
              <Command>
                <CommandInput placeholder="Search banks" />
                <CommandList>
                  <CommandEmpty>
                    {banks.error
                      ? banks.error.message
                      : "No bank by that name."}
                  </CommandEmpty>
                  <CommandGroup>
                    {banks.data?.map((b) => (
                      <CommandItem
                        key={b.name}
                        value={b.name}
                        data-checked={bank === b.name}
                        onSelect={() => {
                          setBank(b.name)
                          setOpen(false)
                        }}
                      >
                        <span className="truncate">{b.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </Field>
        {production && bank && (
          <p className="text-sm text-muted-foreground">
            Some banks keep one connection per person, so linking {bank} here
            can end its connection in another app.
          </p>
        )}
        {go.error && <FieldError>{go.error.message}</FieldError>}
        <DialogFooter>
          <Button type="submit" disabled={!bank || go.isPending}>
            {go.isPending && <Spinner />}
            {bank ? `Continue to ${bank}` : "Continue"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  )
}

type Choice = "new" | "skip" | `${number}`

function MapStep({
  linkId,
  accountId,
  onDone,
}: {
  linkId: number
  accountId?: number
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const status = useQuery(ebQueries.status())
  const accounts = useQuery(queries.accounts())
  const link = status.data?.links.find((l) => l.id === linkId)
  const rows = useMemo(
    () => link?.accounts.filter((a) => a.accountId === null) ?? [],
    [link]
  )
  const [choices, setChoices] = useState<Record<number, Choice>>({})
  const save = useMutation({
    mutationFn: (mappings: AccountMapping[]) => mapAccounts(linkId, mappings),
    onSuccess: (result) => {
      void queryClient.invalidateQueries()
      if (result.error) toast.error(result.error)
      else toast(`${link?.bank}: ${describeSync(result).toLowerCase()}`)
      onDone()
    },
  })

  if (status.isPending || accounts.isPending) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Link to which account?</DialogTitle>
        </DialogHeader>
        <Skeleton className="h-24" />
      </>
    )
  }
  if (!link || !rows.length) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Link to which account?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {link
            ? `Every ${link.bank} account is linked already.`
            : "This bank link is gone. Connect the bank again."}
        </p>
        <DialogFooter>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
      </>
    )
  }

  const taken = new Set(
    status.data?.links.flatMap((l) =>
      l.accounts.map((a) => a.accountId).filter((id) => id !== null)
    )
  )
  const options = (row: BankAccount) =>
    (accounts.data ?? []).filter(
      (a) =>
        !a.closed &&
        a.currency === row.currency &&
        a.provider !== "ibkr" &&
        (!taken.has(a.id) || a.id === row.suggestedAccountId)
    )
  const initial = (row: BankAccount, i: number): Choice => {
    const fits = options(row)
    if (
      row.suggestedAccountId &&
      fits.some((a) => a.id === row.suggestedAccountId)
    )
      return `${row.suggestedAccountId}`
    if (i === 0 && accountId && fits.some((a) => a.id === accountId))
      return `${accountId}`
    return row.currency ? "new" : "skip"
  }
  const choiceOf = (row: BankAccount, i: number) =>
    choices[row.id] ?? initial(row, i)
  const picked = rows.map((r, i) => choiceOf(r, i))
  const duplicate = picked.some(
    (c, i) => c !== "new" && c !== "skip" && picked.indexOf(c) !== i
  )

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(
          rows.map((row, i) => {
            const c = picked[i]
            return {
              bankAccountId: row.id,
              accountId: c === "new" ? "new" : c === "skip" ? null : Number(c),
            }
          })
        )
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle>Link to which account?</DialogTitle>
      </DialogHeader>
      <ItemGroup className="gap-1">
        {rows.map((row, i) => (
          <Item key={row.id} size="sm" className="px-0">
            <ItemContent className="min-w-0">
              <ItemTitle className="truncate">{row.name}</ItemTitle>
              <ItemDescription className="tabular-nums">
                {[row.identifier, row.currency].filter(Boolean).join(" · ")}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select
                value={choiceOf(row, i)}
                onValueChange={(v) =>
                  setChoices((c) => ({ ...c, [row.id]: v as Choice }))
                }
              >
                <SelectTrigger
                  className="w-44"
                  aria-label={`Account for ${row.name}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {row.currency && (
                    <SelectItem value="new">New account</SelectItem>
                  )}
                  {options(row).map((a) => (
                    <SelectItem key={a.id} value={`${a.id}`}>
                      {a.name}
                    </SelectItem>
                  ))}
                  <SelectSeparator />
                  <SelectItem value="skip">Don&rsquo;t link</SelectItem>
                </SelectContent>
              </Select>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {duplicate && (
        <FieldError className="mt-3">
          Two bank accounts can&rsquo;t feed the same florin account.
        </FieldError>
      )}
      {save.error && (
        <FieldError className="mt-3">{save.error.message}</FieldError>
      )}
      <DialogFooter className="mt-6">
        <Button
          type="submit"
          disabled={
            duplicate || save.isPending || picked.every((c) => c === "skip")
          }
        >
          {save.isPending && <Spinner />}
          {save.isPending ? "Importing transactions" : "Link accounts"}
        </Button>
      </DialogFooter>
    </form>
  )
}
