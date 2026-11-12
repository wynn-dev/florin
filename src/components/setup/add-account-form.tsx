import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Account, AccountType, NewAccount } from "@/shared/types"
import { CURRENCIES } from "@/components/settings/choices"
import { capitalise } from "@/components/settings/mcp"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupInput } from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { api, queries } from "@/lib/api"
import { parseAmount } from "@/lib/format"

const TYPES: { value: AccountType; label: string }[] = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit card" },
  { value: "cash", label: "Cash" },
  { value: "investment", label: "Investment" },
]

/** Add manually: name, type and current balance (in any currency). */
export function AddAccountForm({
  onAdded,
  onCancel,
}: {
  onAdded: (account: Account) => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const budgetCurrency = useQuery(queries.settings()).data?.currency ?? "EUR"
  const [name, setName] = useState("")
  const [type, setType] = useState<AccountType>("checking")
  const [currency, setCurrency] = useState(budgetCurrency)
  const [balance, setBalance] = useState("")
  const [error, setError] = useState<{ field: string; text: string } | null>(
    null
  )
  const add = useMutation({
    mutationFn: (account: NewAccount) =>
      api<Account>("/accounts", { method: "POST", body: account }),
    onSuccess: (account) => {
      void queryClient.invalidateQueries({ queryKey: ["accounts"] })
      void queryClient.invalidateQueries({ queryKey: ["setup"] })
      onAdded(account)
    },
    onError: (e) => setError({ field: "name", text: capitalise(e.message) }),
  })
  const invalid = (field: string) => error?.field === field || undefined

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim())
          return setError({ field: "name", text: "Give it a name" })
        const cents = balance.trim() ? parseAmount(balance, currency) : 0
        if (cents === null)
          return setError({ field: "balance", text: "Not a number" })
        add.mutate({
          name: name.trim(),
          type,
          currency,
          // What's owed on a credit card is a negative balance.
          startingBalance: type === "credit" ? -cents : cents,
        })
      }}
    >
      <Field data-invalid={invalid("name")}>
        <FieldLabel htmlFor="account-name">Name</FieldLabel>
        <Input
          id="account-name"
          autoFocus
          autoComplete="off"
          placeholder="Current account"
          value={name}
          aria-invalid={invalid("name")}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
        />
        {invalid("name") && <FieldError>{error!.text}</FieldError>}
      </Field>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
        <Field>
          <FieldLabel htmlFor="account-type">Type</FieldLabel>
          <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
            <SelectTrigger id="account-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field data-invalid={invalid("balance")}>
          <FieldLabel htmlFor="account-balance">
            {type === "credit" ? "Amount owed" : "Balance"}
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="account-balance"
              inputMode="decimal"
              placeholder="0.00"
              className="tabular-nums"
              value={balance}
              aria-invalid={invalid("balance")}
              onChange={(e) => {
                setBalance(e.target.value)
                setError(null)
              }}
            />
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger
                aria-label="Currency"
                size="sm"
                className="mr-0.5 border-0 bg-transparent pr-1.5 pl-2 shadow-none dark:bg-transparent"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end" className="max-h-72">
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InputGroup>
          {invalid("balance") && <FieldError>{error!.text}</FieldError>}
        </Field>
      </div>
      {currency !== budgetCurrency && (
        <p className="-mt-1 text-sm text-muted-foreground">
          Tracking only: not part of the budget
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="outline" disabled={add.isPending}>
          {add.isPending && <Spinner />}
          Add account
        </Button>
      </div>
    </form>
  )
}
