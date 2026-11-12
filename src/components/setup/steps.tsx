// The four first-run steps, each one card: password and currency, accounts,
// starter categories, and connecting an assistant over MCP.
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"
import type { CreatedMcpToken } from "@/shared/mcp"
import type { SetupStatus, StarterCategories } from "@/shared/setup"
import { openAccounts } from "@/components/app-sidebar"
import { Money } from "@/components/money"
import { AddAccountForm } from "@/components/setup/add-account-form"
import {
  CURRENCIES,
  browserCurrency,
  browserLocale,
  currencyName,
} from "@/components/settings/choices"
import { ConnectBankDialog } from "@/components/settings/enable-banking-slot"
import { ConnectIbkrDialog } from "@/components/settings/ibkr-slot"
import {
  CopyField,
  CreatedToken,
  NewTokenForm,
  capitalise,
  useMcpUrl,
} from "@/components/settings/mcp"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemContent, ItemTitle } from "@/components/ui/item"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { api, queries } from "@/lib/api"
import { cn } from "@/lib/utils"

export function StepCard({
  title,
  children,
  footer,
}: {
  title: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
      <CardFooter className="justify-end gap-2 border-t-0 bg-transparent pt-2">
        {footer}
      </CardFooter>
    </Card>
  )
}

// ------------------------------------------------------------- 1. password

export function PasswordStep({
  status,
  onDone,
}: {
  status: SetupStatus
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [currency, setCurrency] = useState(() =>
    status.currencyFixed ? status.currency : browserCurrency()
  )
  const [error, setError] = useState<{ field: string; text: string } | null>(
    null
  )
  const submit = useMutation({
    mutationFn: () =>
      api("/session", {
        method: "POST",
        body: {
          setupCode: code,
          password,
          locale: browserLocale(),
          ...(status.currencyFixed ? {} : { currency }),
        },
      }),
    onSuccess: async () => {
      queryClient.clear()
      // Reloads the root route's locale for the signed-in app.
      await router.invalidate()
      onDone()
    },
    onError: (e) =>
      setError({
        field: e.message.includes("setup code")
          ? "code"
          : e.message.includes("password")
            ? "password"
            : "currency",
        text: capitalise(e.message.replace(/; run florin setup-code.*/, "")),
      }),
  })
  const invalid = (field: string) => error?.field === field || undefined
  const clear = () => setError(null)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!code.trim())
          return setError({ field: "code", text: "Enter the setup code" })
        if (password.length < 8)
          return setError({ field: "password", text: "At least 8 characters" })
        if (password !== confirm)
          return setError({ field: "confirm", text: "Doesn't match" })
        submit.mutate()
      }}
    >
      <StepCard
        title="Password and currency"
        footer={
          <Button type="submit" className="w-full" disabled={submit.isPending}>
            {submit.isPending && <Spinner />}
            Continue
          </Button>
        }
      >
        <FieldGroup className="gap-5">
          <Field data-invalid={invalid("code")}>
            <FieldLabel htmlFor="setup-code">Setup code</FieldLabel>
            <Input
              id="setup-code"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX"
              className="font-mono tracking-wider uppercase placeholder:tracking-wider"
              value={code}
              aria-invalid={invalid("code")}
              onChange={(e) => {
                setCode(e.target.value)
                clear()
              }}
            />
            {invalid("code") ? (
              <FieldError>{error!.text}</FieldError>
            ) : (
              <FieldDescription>
                florin printed it when it started.{" "}
                <code className="font-mono text-[12px]">florin setup-code</code>{" "}
                shows it again.
              </FieldDescription>
            )}
          </Field>
          <Field data-invalid={invalid("password")}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              aria-invalid={invalid("password")}
              onChange={(e) => {
                setPassword(e.target.value)
                clear()
              }}
            />
            {invalid("password") && <FieldError>{error!.text}</FieldError>}
          </Field>
          <Field data-invalid={invalid("confirm")}>
            <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              aria-invalid={invalid("confirm")}
              onChange={(e) => {
                setConfirm(e.target.value)
                clear()
              }}
            />
            {invalid("confirm") && <FieldError>{error!.text}</FieldError>}
          </Field>
          <Field data-invalid={invalid("currency")}>
            <FieldLabel htmlFor="currency">Budget currency</FieldLabel>
            {status.currencyFixed ? (
              <p className="flex h-8 items-center gap-2 text-sm">
                <span className="font-medium">{status.currency}</span>
                <span className="text-muted-foreground">
                  Fixed once transactions exist
                </span>
              </p>
            ) : (
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      <span className="w-9 font-medium">{c}</span>
                      <span className="text-muted-foreground">
                        {currencyName(c, browserLocale())}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {invalid("currency") && <FieldError>{error!.text}</FieldError>}
          </Field>
        </FieldGroup>
      </StepCard>
    </form>
  )
}

// ------------------------------------------------------------- 2. accounts

export function AccountsStep({ onDone }: { onDone: () => void }) {
  const accounts = openAccounts(useQuery(queries.accounts()).data)
  const budgetCurrency = useQuery(queries.settings()).data?.currency
  const [adding, setAdding] = useState(false)
  const [bank, setBank] = useState(false)
  const [ibkr, setIbkr] = useState(false)

  return (
    <StepCard
      title="Accounts"
      footer={
        accounts.length ? (
          <Button onClick={onDone}>Continue</Button>
        ) : (
          <Button variant="ghost" onClick={onDone}>
            Skip for now
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {accounts.length > 0 && (
          <ul className="flex flex-col">
            {accounts.map((a) => (
              <li
                key={a.id}
                className="flex h-10 items-center justify-between gap-4 border-b text-sm"
              >
                <span className="truncate">{a.name}</span>
                <Money
                  cents={a.balance}
                  currency={a.currency}
                  symbol={a.currency !== budgetCurrency}
                  className="text-muted-foreground"
                />
              </li>
            ))}
          </ul>
        )}
        {adding ? (
          <AddAccountForm
            onAdded={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <Choice
              title="Connect a bank"
              onClick={ConnectBankDialog ? () => setBank(true) : undefined}
            />
            <Choice
              title={accounts.length ? "Add another manually" : "Add manually"}
              onClick={() => setAdding(true)}
            />
            <div className="flex h-8 items-center justify-between px-3 text-sm">
              {ConnectIbkrDialog ? (
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  onClick={() => setIbkr(true)}
                >
                  Interactive Brokers
                </button>
              ) : (
                <>
                  <span className="text-muted-foreground">
                    Interactive Brokers
                  </span>
                  <span className="text-muted-foreground">
                    In Settings after setup
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {/* Always rendered: the bank's redirect comes back here and the dialog
          reopens itself to link the accounts. */}
      {ConnectBankDialog && (
        <ConnectBankDialog open={bank} onOpenChange={setBank} />
      )}
      {ConnectIbkrDialog && (
        <ConnectIbkrDialog open={ibkr} onOpenChange={setIbkr} />
      )}
    </StepCard>
  )
}

/** One way to add accounts; without onClick, where it is instead. */
function Choice({ title, onClick }: { title: string; onClick?: () => void }) {
  if (!onClick)
    return (
      <Item variant="outline" className="h-11 py-0">
        <ItemContent>
          <ItemTitle>{title}</ItemTitle>
        </ItemContent>
        <span className="text-sm text-muted-foreground">
          In Settings after setup
        </span>
      </Item>
    )
  return (
    <Item variant="outline" className="h-11 py-0" asChild>
      <button type="button" onClick={onClick} className="hover:bg-muted/50">
        <ItemContent>
          <ItemTitle>{title}</ItemTitle>
        </ItemContent>
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </button>
    </Item>
  )
}

// ----------------------------------------------------------- 3. categories

const STARTER: StarterCategories["groups"] = [
  {
    name: "Bills",
    categories: ["Rent", "Utilities", "Phone & internet", "Insurance"],
  },
  {
    name: "Everyday",
    categories: ["Groceries", "Eating out", "Transport", "Household"],
  },
  {
    name: "Lifestyle",
    categories: ["Shopping", "Entertainment", "Health", "Subscriptions"],
  },
  { name: "Savings", categories: ["Emergency fund", "Holidays"] },
]

type Item = { name: string; on: boolean }

export function CategoriesStep({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient()
  const [groups, setGroups] = useState(() =>
    STARTER.map((g) => ({
      name: g.name,
      items: g.categories.map((name): Item => ({ name, on: true })),
    }))
  )
  const apply = useMutation({
    mutationFn: (body: StarterCategories) =>
      api("/setup/categories", { method: "POST", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["categories"] })
      void queryClient.invalidateQueries({ queryKey: ["budget"] })
      onDone()
    },
  })
  const chosen = groups
    .map((g) => ({
      name: g.name,
      categories: g.items
        .filter((i) => i.on && i.name.trim())
        .map((i) => i.name.trim()),
    }))
    .filter((g) => g.categories.length)
  const update = (gi: number, ii: number, item: Partial<Item>) =>
    setGroups((gs) =>
      gs.map((g, j) =>
        j !== gi
          ? g
          : {
              ...g,
              items: g.items.map((it, k) =>
                k === ii ? { ...it, ...item } : it
              ),
            }
      )
    )

  return (
    <StepCard
      title="Categories"
      footer={
        <>
          <Button
            variant="ghost"
            disabled={apply.isPending}
            onClick={() => apply.mutate({ groups: [] })}
          >
            Start empty
          </Button>
          <Button
            disabled={apply.isPending || !chosen.length}
            onClick={() => apply.mutate({ groups: chosen })}
          >
            {apply.isPending && <Spinner />}
            Use these
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
        {groups.map((g, gi) => (
          <fieldset key={g.name} className="flex flex-col">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">
              {g.name}
            </legend>
            {g.items.map((item, ii) => (
              <div key={ii} className="flex h-8 items-center gap-2">
                <Checkbox
                  checked={item.on}
                  onCheckedChange={(v) => update(gi, ii, { on: v === true })}
                  aria-label={`Use ${item.name}`}
                />
                <input
                  value={item.name}
                  onChange={(e) => update(gi, ii, { name: e.target.value })}
                  aria-label={`${g.name} category name`}
                  className={cn(
                    "-mx-1 h-7 min-w-0 flex-1 rounded-md bg-transparent px-1 text-sm outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-0",
                    !item.on && "text-muted-foreground line-through"
                  )}
                />
              </div>
            ))}
          </fieldset>
        ))}
      </div>
      {apply.error && (
        <p className="mt-4 text-sm text-negative">
          {capitalise(apply.error.message)}
        </p>
      )}
    </StepCard>
  )
}

// ------------------------------------------------------------ 4. assistant

export function AssistantStep({ onDone }: { onDone: () => void }) {
  const url = useMcpUrl()
  const [created, setCreated] = useState<CreatedMcpToken | null>(null)
  return (
    <StepCard
      title="Connect an assistant"
      footer={
        created ? (
          <Button onClick={onDone}>Done</Button>
        ) : (
          <Button variant="ghost" onClick={onDone}>
            Skip for now
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <Field>
          <FieldLabel>Endpoint</FieldLabel>
          {url && <CopyField value={url} label="Endpoint" />}
        </Field>
        {created ? (
          <CreatedToken token={created} />
        ) : (
          <NewTokenForm
            autoFocus={false}
            inline
            onCreated={setCreated}
            footer={(pending) => (
              <Button type="submit" variant="outline" disabled={pending}>
                {pending && <Spinner />}
                Create
              </Button>
            )}
          />
        )}
      </div>
    </StepCard>
  )
}
