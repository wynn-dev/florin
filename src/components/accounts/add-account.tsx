import { useForm } from "@tanstack/react-form"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { ChevronRightIcon } from "lucide-react"
import { TYPE_LABELS, useCreateAccount } from "./queries"
import type { AccountType } from "@/shared/types"
import { queries } from "@/lib/api"
import { ConnectBankDialog } from "@/components/connections/enable-banking/connect-bank-dialog"
import { ConnectIbkrDialog } from "@/components/connections/ibkr/connect-ibkr-dialog"
import { formatAmountInput, parseAmount } from "@/lib/format"
import { Button } from "@/components/ui/button"
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
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

/** Which step of Add account is open: the three choices, or one of them. */
export type AddStep = "choose" | "bank" | "ibkr" | "manual"

/** The ECB's reference currencies, which florin can convert. */
const CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "JPY",
  "CAD",
  "AUD",
  "NZD",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "ISK",
  "TRY",
  "CNY",
  "HKD",
  "SGD",
  "KRW",
  "INR",
  "IDR",
  "MYR",
  "PHP",
  "THB",
  "ILS",
  "MXN",
  "BRL",
  "ZAR",
]

const TYPES: AccountType[] = [
  "checking",
  "savings",
  "credit",
  "cash",
  "investment",
  "loan",
]

/**
 * Add account: Connect a bank, Connect Interactive Brokers, or Add manually
 * (name, type, current balance with a compact currency select).
 */
export function AddAccountDialog({
  step,
  onStepChange,
}: {
  step: AddStep | null
  onStepChange: (step: AddStep | null) => void
}) {
  const close = (open: boolean) => {
    if (!open) onStepChange(null)
  }
  return (
    <>
      <Dialog
        open={step === "choose" || step === "manual"}
        onOpenChange={close}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {step === "manual" ? "Add manually" : "Add account"}
            </DialogTitle>
          </DialogHeader>
          {step === "manual" ? (
            <ManualForm
              onDone={() => onStepChange(null)}
              onBack={() => onStepChange("choose")}
            />
          ) : (
            <ItemGroup className="gap-1">
              {(
                [
                  ["bank", "Connect a bank"],
                  ["ibkr", "Connect Interactive Brokers"],
                  ["manual", "Add manually"],
                ] as const
              ).map(([next, label]) => (
                <Item key={next} variant="outline" asChild>
                  <button
                    type="button"
                    onClick={() => onStepChange(next)}
                    className="text-left"
                  >
                    <ItemContent>
                      <ItemTitle>{label}</ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <ChevronRightIcon className="size-4 text-muted-foreground" />
                    </ItemActions>
                  </button>
                </Item>
              ))}
            </ItemGroup>
          )}
        </DialogContent>
      </Dialog>
      <ConnectBankDialog open={step === "bank"} onOpenChange={close} />
      <ConnectIbkrDialog open={step === "ibkr"} onOpenChange={close} />
    </>
  )
}

function ManualForm({
  onDone,
  onBack,
}: {
  onDone: () => void
  onBack: () => void
}) {
  const budgetCurrency = useQuery(queries.settings()).data?.currency ?? "EUR"
  const create = useCreateAccount()
  const navigate = useNavigate()
  const currencies = [
    budgetCurrency,
    ...CURRENCIES.filter((c) => c !== budgetCurrency),
  ]

  const form = useForm({
    defaultValues: {
      name: "",
      type: "checking" as AccountType,
      balance: "",
      currency: budgetCurrency,
    },
    onSubmit: async ({ value, formApi }) => {
      const owed = value.type === "credit" || value.type === "loan"
      const text = value.balance.trim()
      const negative = /^[-−]/.test(text)
      const amount =
        text === "" ? 0 : parseAmount(text.replace(/^[-−]/, ""), value.currency)
      if (amount === null) return
      try {
        const account = await create.mutateAsync({
          name: value.name.trim(),
          type: value.type,
          currency: value.currency,
          startingBalance: owed || negative ? -amount : amount,
        })
        onDone()
        await navigate({
          to: "/accounts/$id",
          params: { id: String(account.id) },
        })
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: { fields: { name: (error as Error).message } },
        })
      }
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
      className="flex flex-col gap-6"
    >
      <FieldGroup className="gap-4">
        <form.Field
          name="name"
          validators={{
            onSubmit: ({ value }) =>
              value.trim() ? undefined : "Give the account a name",
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor="account-name">Name</FieldLabel>
              <Input
                id="account-name"
                autoFocus
                autoComplete="off"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError>{field.state.meta.errors.join(", ")}</FieldError>
            </Field>
          )}
        </form.Field>
        <form.Field name="type">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="account-type">Type</FieldLabel>
              <Select
                value={field.state.value}
                onValueChange={(v) => field.handleChange(v as AccountType)}
              >
                <SelectTrigger id="account-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>
        <form.Subscribe selector={(s) => [s.values.type, s.values.currency]}>
          {([type, currency]) => (
            <form.Field
              name="balance"
              validators={{
                onChange: ({ value }) =>
                  value.trim() === "" ||
                  parseAmount(value.trim().replace(/^[-−]/, ""), currency) !==
                    null
                    ? undefined
                    : "Enter a plain number, like 1250.00",
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="account-balance">
                    {type === "credit" || type === "loan"
                      ? "Amount owed"
                      : "Current balance"}
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="account-balance"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={formatAmountInput(0, currency)}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={field.state.meta.errors.length > 0}
                      className="tabular-nums"
                    />
                    <InputGroupAddon align="inline-end" className="pr-1">
                      <form.Field name="currency">
                        {(currencyField) => (
                          <Select
                            value={currencyField.state.value}
                            onValueChange={currencyField.handleChange}
                          >
                            <SelectTrigger
                              size="sm"
                              aria-label="Currency"
                              className="border-0 bg-transparent shadow-none hover:bg-muted dark:bg-transparent"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="end" className="max-h-72">
                              {currencies.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </form.Field>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldError>{field.state.meta.errors.join(", ")}</FieldError>
                  {currency !== budgetCurrency && (
                    <p className="text-sm text-muted-foreground">
                      Tracking only: not part of the budget
                    </p>
                  )}
                </Field>
              )}
            </form.Field>
          )}
        </form.Subscribe>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => (
            <Button type="submit" disabled={submitting}>
              {submitting && <Spinner />}
              Add account
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}
