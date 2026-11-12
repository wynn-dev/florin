import { useEffect, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDownIcon } from "lucide-react"
import { queries } from "@/lib/api"
import {
  currencySymbol,
  formatAmountInput,
  formatDate,
  formatDayTime,
  parseAmount,
  today,
} from "@/lib/format"
import { useIsMobile } from "@/hooks/use-mobile"
import { AmountInput } from "@/components/amount-input"
import { CategoryPicker } from "@/components/category-picker"
import { PayeePicker } from "@/components/payee-picker"
import { sourceName } from "@/components/source-label"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
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
  InputGroupText,
} from "@/components/ui/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import {
  transactionQueries,
  useDeleteTransactions,
  useSaveTransaction,
} from "./queries"
import type { ReactNode } from "react"
import type { CategoryChoice } from "@/components/category-picker"
import type { PayeeChoice } from "@/components/payee-picker"
import type {
  NewTransaction,
  Transaction,
  TransactionPatch,
} from "@/shared/types"

/**
 * Adds a transaction (no `transaction`) or edits one: a right Sheet on a
 * desktop, a Drawer on a phone. Editing also shows what the bank sent, the
 * transaction's history and Delete.
 */
export function TransactionSheet({
  open,
  onOpenChange,
  transaction,
  defaultAccountId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The transaction to edit; absent or null to add one. */
  transaction?: Transaction | null
  /** The account a new transaction starts in. */
  defaultAccountId?: number
}) {
  const isMobile = useIsMobile()
  // Keep showing the last transaction while the sheet animates closed.
  const [shown, setShown] = useState(transaction)
  if (transaction && transaction !== shown) setShown(transaction)
  const editing = transaction === undefined ? null : (transaction ?? shown)
  const title = editing ? "Edit transaction" : "New transaction"
  const body = (
    <TransactionForm
      key={`${editing?.id ?? "new"}-${open}`}
      transaction={editing ?? null}
      defaultAccountId={defaultAccountId}
      onDone={() => onOpenChange(false)}
    />
  )

  if (isMobile)
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[92svh]">
          <DrawerHeader className="pb-2 text-left">
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    )
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full gap-0 sm:max-w-[420px]"
        // Editing opens to read; the first field isn't focused until clicked.
        onOpenAutoFocus={(e) => {
          if (transaction) e.preventDefault()
        }}
      >
        <SheetHeader className="px-6 pt-5 pb-2">
          <SheetTitle className="text-base">{title}</SheetTitle>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  )
}

type Values = {
  date: string
  accountId: number | null
  payee: PayeeChoice | null
  category: CategoryChoice | null
  /** For a transfer out of the budget (into a tracking account): the budget category it counts against. */
  budgetCategoryId: number | null
  amount: number | null
  /** What a transfer into an account in another currency receives, unsigned. */
  received: string
  notes: string
}

function initialValues(
  t: Transaction | null,
  defaultAccountId: number | undefined,
  currency: (accountId: number) => string
): Values {
  if (!t)
    return {
      date: today(),
      accountId: defaultAccountId ?? null,
      payee: null,
      category: null,
      budgetCategoryId: null,
      amount: null,
      received: "",
      notes: "",
    }
  return {
    date: t.date,
    accountId: t.accountId,
    payee:
      t.payeeId && t.payeeName ? { id: t.payeeId, name: t.payeeName } : null,
    category: t.transferAccountId
      ? { type: "transfer", accountId: t.transferAccountId }
      : t.categoryId
        ? { type: "category", id: t.categoryId }
        : null,
    budgetCategoryId: t.transferAccountId ? t.categoryId : null,
    amount: t.amount,
    received:
      t.transferAmount !== null && t.transferAccountId
        ? formatAmountInput(t.transferAmount, currency(t.transferAccountId))
        : "",
    notes: t.notes,
  }
}

function TransactionForm({
  transaction: t,
  defaultAccountId,
  onDone,
}: {
  transaction: Transaction | null
  defaultAccountId?: number
  onDone: () => void
}) {
  const client = useQueryClient()
  const accountList = useQuery(queries.accounts()).data ?? []
  const accounts = new Map(accountList.map((a) => [a.id, a]))
  const budgetCurrency = useQuery(queries.settings()).data?.currency ?? "EUR"
  const currency = (id: number | null) =>
    (id !== null && accounts.get(id)?.currency) || budgetCurrency
  const save = useSaveTransaction()
  const remove = useDeleteTransactions()
  const [error, setError] = useState<string | null>(null)
  const initial = initialValues(t, defaultAccountId, currency)

  const form = useForm({
    defaultValues: initial,
    onSubmit: async ({ value }) => {
      setError(null)
      const input = toInput(value, t, initial, currency)
      if (!input) return onDone()
      try {
        await save.mutateAsync(input)
        onDone()
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't save.")
      }
    },
  })

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-6 pt-3 pb-6">
        <FieldGroup className="gap-5">
          <div className="grid grid-cols-2 gap-3">
            <form.Field name="date">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="t-date">Date</FieldLabel>
                  <DatePicker
                    id="t-date"
                    value={field.state.value}
                    onChange={field.handleChange}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field
              name="accountId"
              validators={{
                onSubmit: ({ value }) =>
                  value === null ? "Pick an account" : undefined,
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="t-account">Account</FieldLabel>
                  <Select
                    value={field.state.value?.toString() ?? ""}
                    onValueChange={(v) => field.handleChange(Number(v))}
                  >
                    <SelectTrigger
                      id="t-account"
                      className="h-9! w-full"
                      aria-invalid={field.state.meta.errors.length > 0}
                    >
                      <SelectValue placeholder="Account" />
                    </SelectTrigger>
                    <SelectContent>
                      {accountList
                        .filter((a) => !a.closed || a.id === field.state.value)
                        .map((a) => (
                          <SelectItem key={a.id} value={a.id.toString()}>
                            {a.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FieldError errors={toErrors(field.state.meta.errors)} />
                </Field>
              )}
            </form.Field>
          </div>

          <form.Subscribe selector={(s) => s.values.category}>
            {(category) =>
              category?.type !== "transfer" && (
                <form.Field name="payee">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="t-payee">Payee</FieldLabel>
                      <PayeePicker
                        id="t-payee"
                        value={field.state.value}
                        onChange={(choice) => {
                          field.handleChange(choice)
                          if (choice.id === null) return
                          // A known payee brings its last category when none is set.
                          void client
                            .fetchQuery(
                              transactionQueries.lastForPayee(choice.id)
                            )
                            .then((last) => {
                              if (
                                last?.categoryId &&
                                !form.getFieldValue("category")
                              )
                                form.setFieldValue("category", {
                                  type: "category",
                                  id: last.categoryId,
                                })
                            })
                        }}
                      />
                    </Field>
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>

          <form.Subscribe selector={(s) => s.values.accountId}>
            {(accountId) => (
              <form.Field name="category">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="t-category">Category</FieldLabel>
                    <CategoryPicker
                      id="t-category"
                      value={field.state.value}
                      onChange={field.handleChange}
                      transfers={{ excludeAccountId: accountId ?? undefined }}
                    />
                  </Field>
                )}
              </form.Field>
            )}
          </form.Subscribe>

          <form.Subscribe
            selector={(s) => [s.values.accountId, s.values.category] as const}
          >
            {([accountId, category]) => {
              const target =
                category?.type === "transfer"
                  ? accounts.get(category.accountId)
                  : undefined
              const source =
                accountId === null ? undefined : accounts.get(accountId)
              if (!target || !source?.onBudget || target.onBudget) return null
              return (
                <form.Field name="budgetCategoryId">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="t-budget-category">
                        Budget category
                      </FieldLabel>
                      <CategoryPicker
                        id="t-budget-category"
                        value={
                          field.state.value
                            ? { type: "category", id: field.state.value }
                            : null
                        }
                        onChange={(c) =>
                          c.type === "category" && field.handleChange(c.id)
                        }
                      />
                    </Field>
                  )}
                </form.Field>
              )
            }}
          </form.Subscribe>

          <form.Subscribe selector={(s) => s.values.accountId}>
            {(accountId) => (
              <form.Field
                name="amount"
                validators={{
                  onSubmit: ({ value }) =>
                    value === null || value === 0
                      ? "Enter an amount"
                      : undefined,
                }}
              >
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0}>
                    <FieldLabel htmlFor="t-amount">Amount</FieldLabel>
                    <AmountInput
                      id="t-amount"
                      value={field.state.value}
                      onChange={field.handleChange}
                      currency={currency(accountId)}
                      invalid={field.state.meta.errors.length > 0}
                    />
                    <FieldError errors={toErrors(field.state.meta.errors)} />
                  </Field>
                )}
              </form.Field>
            )}
          </form.Subscribe>

          <form.Subscribe
            selector={(s) =>
              [
                s.values.accountId,
                s.values.category,
                s.values.amount,
                s.values.date,
              ] as const
            }
          >
            {([accountId, category, amount, date]) => {
              if (category?.type !== "transfer" || accountId === null)
                return null
              const from = currency(accountId)
              const to = currency(category.accountId)
              if (from === to) return null
              return (
                <form.Field name="received">
                  {(field) => (
                    <ReceivedField
                      value={field.state.value}
                      onChange={field.handleChange}
                      amount={amount}
                      from={from}
                      to={to}
                      date={date}
                    />
                  )}
                </form.Field>
              )
            }}
          </form.Subscribe>

          <form.Field name="notes">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="t-notes">Memo</FieldLabel>
                <Input
                  id="t-notes"
                  className="h-9"
                  autoComplete="off"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </Field>
            )}
          </form.Field>
        </FieldGroup>

        {t && <FromYourBank t={t} />}
        {t && <History id={t.id} />}
      </div>

      <div className="flex items-center gap-2 border-t px-6 py-3">
        {t && (
          <Button
            type="button"
            variant="ghost"
            className="-ml-2.5 text-muted-foreground hover:text-negative"
            onClick={() => {
              remove.mutate([t])
              onDone()
            }}
          >
            Delete
          </Button>
        )}
        {error && (
          <span role="alert" className="truncate text-sm text-negative">
            {error}
          </span>
        )}
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => (
            <Button
              type="submit"
              className="ml-auto min-w-20"
              disabled={submitting}
            >
              {submitting && <Spinner />}
              {t ? "Save" : "Add"}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  )
}

function toErrors(errors: unknown[]): { message: string }[] {
  return errors.filter(Boolean).map((e) => ({ message: String(e) }))
}

/** The request the form's values make: a whole new transaction, or only what changed. */
function toInput(
  v: Values,
  t: Transaction | null,
  initial: Values,
  currency: (id: number | null) => string
):
  | { id: number; patch: TransactionPatch }
  | { id?: undefined; create: NewTransaction }
  | null {
  const transfer = v.category?.type === "transfer" ? v.category : null
  const received =
    transfer && currency(v.accountId) !== currency(transfer.accountId)
      ? parseAmount(v.received, currency(transfer.accountId))
      : null
  // Money that leaves one account arrives in the other.
  const transferAmount =
    received === null ? undefined : (v.amount ?? 0) < 0 ? received : -received

  if (!t) {
    return {
      create: {
        accountId: v.accountId!,
        date: v.date,
        amount: v.amount!,
        ...(v.payee && !transfer
          ? v.payee.id !== null
            ? { payeeId: v.payee.id }
            : { payeeName: v.payee.name }
          : {}),
        categoryId:
          v.category?.type === "category"
            ? v.category.id
            : transfer
              ? v.budgetCategoryId
              : null,
        notes: v.notes.trim(),
        transferAccountId: transfer?.accountId,
        transferAmount,
      },
    }
  }

  const patch: TransactionPatch = {}
  if (v.date !== initial.date) patch.date = v.date
  if (v.accountId !== initial.accountId) patch.accountId = v.accountId!
  if (v.amount !== initial.amount) patch.amount = v.amount!
  if (v.notes.trim() !== initial.notes) patch.notes = v.notes.trim()
  if (!transfer && v.payee?.name !== initial.payee?.name) {
    if (v.payee === null) patch.payeeId = null
    else if (v.payee.id !== null) patch.payeeId = v.payee.id
    else patch.payeeName = v.payee.name
  }
  const was = initial.category
  if (transfer) {
    if (was?.type !== "transfer" || was.accountId !== transfer.accountId)
      patch.transferAccountId = transfer.accountId
    if (v.budgetCategoryId !== initial.budgetCategoryId)
      patch.categoryId = v.budgetCategoryId
    if (
      transferAmount !== undefined &&
      (v.received !== initial.received || patch.transferAccountId)
    )
      patch.transferAmount = transferAmount
  } else {
    if (was?.type === "transfer") patch.transferAccountId = null
    const id = v.category?.type === "category" ? v.category.id : null
    if (id !== t.categoryId) patch.categoryId = id
  }
  return Object.keys(patch).length ? { id: t.id, patch } : null
}

function DatePicker({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="h-9 w-full justify-between font-normal tabular-nums"
        >
          {formatDate(value)}
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-1">
        <Calendar
          mode="single"
          weekStartsOn={1}
          selected={new Date(`${value}T00:00:00`)}
          defaultMonth={new Date(`${value}T00:00:00`)}
          onSelect={(date) => {
            if (!date) return
            onChange(today(date))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * "Received US$": what a transfer into an account in another currency
 * brings in, prefilled at that day's ECB rate until the person types.
 */
function ReceivedField({
  value,
  onChange,
  amount,
  from,
  to,
  date,
}: {
  value: string
  onChange: (value: string) => void
  amount: number | null
  from: string
  to: string
  date: string
}) {
  const [typed, setTyped] = useState(value !== "")
  const converted = useQuery({
    ...transactionQueries.convert(Math.abs(amount ?? 0), from, to, date),
    enabled: !typed && !!amount,
  }).data
  const suggestion =
    converted === null || converted === undefined
      ? ""
      : formatAmountInput(converted, to)
  const shown = typed ? value : suggestion
  useEffect(() => {
    if (!typed && suggestion !== value) onChange(suggestion)
  }, [typed, suggestion, value, onChange])
  return (
    <Field>
      <FieldLabel htmlFor="t-received">Received</FieldLabel>
      <InputGroup className="h-9">
        <InputGroupInput
          id="t-received"
          inputMode="decimal"
          autoComplete="off"
          className="text-right tabular-nums"
          placeholder={formatAmountInput(0, to)}
          value={shown}
          onChange={(e) => {
            setTyped(true)
            onChange(e.target.value)
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>{currencySymbol(to)}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  )
}

/** What the bank (or the file) sent, read-only. */
function FromYourBank({ t }: { t: Transaction }) {
  const bankId = t.importedId?.startsWith("row:") ? null : t.importedId
  if (!t.importedPayee && !t.bookedDate && !bankId) return null
  return (
    <Section title="From your bank">
      <dl className="flex flex-col gap-1.5">
        {t.importedPayee && <Row label="Description">{t.importedPayee}</Row>}
        {t.bookedDate && t.bookedDate !== t.date && (
          <Row label="Booked">{formatDate(t.bookedDate)}</Row>
        )}
        {bankId && (
          <Row label="Transaction ID">
            <span className="font-mono text-xs">{bankId}</span>
          </Row>
        )}
      </dl>
    </Section>
  )
}

/** "Added by Revolut sync · 10 Nov 06:12", oldest first. */
function History({ id }: { id: number }) {
  const history = useQuery(transactionQueries.history(id))
  if (!history.data?.length) return null
  return (
    <Section title="History">
      <ol className="flex flex-col gap-1.5 text-sm">
        {history.data.map((line) => {
          const who = sourceName(line.actor)
          return (
            <li key={line.id} className="flex items-baseline gap-4">
              <span className="min-w-0 flex-1">
                {line.text} by {who === "You" ? "you" : who}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatDayTime(line.at)}
              </span>
            </li>
          )
        })}
      </ol>
    </Section>
  )
}
