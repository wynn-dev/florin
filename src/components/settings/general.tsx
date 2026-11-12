import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { toast } from "sonner"
import type { Settings } from "@/shared/types"
import {
  CURRENCIES,
  LOCALES,
  currencyName,
  localeName,
  localeSample,
} from "@/components/settings/choices"
import { capitalise } from "@/components/settings/mcp"
import { Aside, SettingsRow, SettingsSection } from "@/components/settings/row"
import { THEMES } from "@/components/app-sidebar"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api, queries } from "@/lib/api"
import { formatDate, formatDateTime, getLocale } from "@/lib/format"
import { useTheme } from "@/lib/theme"
import type { Theme } from "@/lib/theme"

const CONTROL = "w-44 sm:w-64"

function useSaveSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Settings>) =>
      api<Settings>("/settings", { method: "PATCH", body: patch }),
    onSuccess: (settings) =>
      queryClient.setQueryData(queries.settings().queryKey, settings),
    onError: (error) => toast.error(capitalise(error.message)),
  })
}

export function GeneralSettings() {
  const settings = useQuery(queries.settings())
  if (!settings.data)
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    )
  return (
    <SettingsSection>
      <CurrencyRow settings={settings.data} />
      <LocaleRow settings={settings.data} />
      <ThemeRow />
      <PasswordRow />
      <ExchangeRatesRow />
      <PublicAddressRow settings={settings.data} />
      <ExportRow />
      <SignOutRow />
    </SettingsSection>
  )
}

function CurrencyRow({ settings }: { settings: Settings }) {
  const setup = useQuery(queries.setup())
  const save = useSaveSettings()
  const queryClient = useQueryClient()
  const locale = getLocale()
  if (setup.data?.currencyFixed)
    return (
      <SettingsRow title="Budget currency">
        <Aside>Fixed once transactions exist</Aside>
        <span className="text-sm font-medium">{settings.currency}</span>
      </SettingsRow>
    )
  return (
    <SettingsRow title="Budget currency" htmlFor="currency">
      <Select
        value={settings.currency}
        onValueChange={(currency) =>
          save.mutate(
            { currency },
            { onSuccess: () => queryClient.invalidateQueries() }
          )
        }
      >
        <SelectTrigger id="currency" className={CONTROL}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end" className="max-h-80">
          {CURRENCIES.map((c) => (
            <SelectItem key={c} value={c}>
              <span className="w-9 font-medium">{c}</span>
              <span className="text-muted-foreground">
                {currencyName(c, locale)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  )
}

function LocaleRow({ settings }: { settings: Settings }) {
  const save = useSaveSettings()
  const router = useRouter()
  const current = settings.locale || "en-GB"
  const options = LOCALES.includes(current) ? LOCALES : [current, ...LOCALES]
  return (
    <SettingsRow title="Locale" htmlFor="locale">
      <Select
        value={current}
        onValueChange={(locale) =>
          save.mutate(
            { locale },
            // The root route reloads the locale and re-renders every page.
            { onSuccess: () => void router.invalidate() }
          )
        }
      >
        <SelectTrigger id="locale" className={CONTROL}>
          <SelectValue>{localeName(current)}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="end" className="max-h-80">
          {options.map((tag) => (
            <SelectItem key={tag} value={tag}>
              {localeName(tag)}
              <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
                {localeSample(tag)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  )
}

function ThemeRow() {
  const [theme, setTheme] = useTheme()
  return (
    <SettingsRow title="Theme">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={theme}
        onValueChange={(v) => v && setTheme(v as Theme)}
      >
        {THEMES.map((t) => (
          <ToggleGroupItem
            key={t.value}
            value={t.value}
            className="px-3! data-[state=on]:bg-muted"
          >
            {t.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </SettingsRow>
  )
}

function PasswordRow() {
  const [open, setOpen] = useState(false)
  return (
    <SettingsRow title="Password">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Change…
      </Button>
      <PasswordDialog open={open} onOpenChange={setOpen} />
    </SettingsRow>
  )
}

function PasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<{ field: string; text: string } | null>(
    null
  )
  const change = useMutation({
    mutationFn: () =>
      api("/password", { method: "POST", body: { current, next } }),
    onSuccess: () => {
      onOpenChange(false)
      toast("Password changed. Other devices are signed out.")
    },
    onError: (e) =>
      setError({
        field: e.message.includes("current") ? "current" : "next",
        text: capitalise(e.message),
      }),
  })
  const reset = () => {
    setCurrent("")
    setNext("")
    setConfirm("")
    setError(null)
  }
  const invalid = (field: string) => error?.field === field || undefined
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setTimeout(reset, 200)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (next.length < 8)
              return setError({ field: "next", text: "At least 8 characters" })
            if (next !== confirm)
              return setError({ field: "confirm", text: "Doesn't match" })
            change.mutate()
          }}
        >
          <FieldGroup className="gap-4">
            <Field data-invalid={invalid("current")}>
              <FieldLabel htmlFor="current-password">
                Current password
              </FieldLabel>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={current}
                aria-invalid={invalid("current")}
                onChange={(e) => {
                  setCurrent(e.target.value)
                  setError(null)
                }}
              />
              {invalid("current") && <FieldError>{error!.text}</FieldError>}
            </Field>
            <Field data-invalid={invalid("next")}>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={next}
                aria-invalid={invalid("next")}
                onChange={(e) => {
                  setNext(e.target.value)
                  setError(null)
                }}
              />
              {invalid("next") && <FieldError>{error!.text}</FieldError>}
            </Field>
            <Field data-invalid={invalid("confirm")}>
              <FieldLabel htmlFor="confirm-password">Confirm</FieldLabel>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                aria-invalid={invalid("confirm")}
                onChange={(e) => {
                  setConfirm(e.target.value)
                  setError(null)
                }}
              />
              {invalid("confirm") && <FieldError>{error!.text}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending && <Spinner />}
              Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Shown only when an account is in another currency than the budget's. */
function ExchangeRatesRow() {
  const queryClient = useQueryClient()
  const status = useQuery(queries.fxStatus())
  const refresh = useMutation({
    mutationFn: () => api("/fx/refresh", { method: "POST" }),
    onSuccess: (data) =>
      queryClient.setQueryData(queries.fxStatus().queryKey, data as never),
    onError: (error) => toast.error(capitalise(error.message)),
  })
  if (!status.data?.currencies.length) return null
  const dates = status.data.currencies.map((c) => c.latestDate)
  const oldest = dates.includes(null) ? null : dates.sort()[0]
  const error = status.data.job.lastError
  return (
    <SettingsRow title="Exchange rates">
      {error ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate text-sm text-negative">
              ECB update failed
            </span>
          </TooltipTrigger>
          <TooltipContent>{error}</TooltipContent>
        </Tooltip>
      ) : (
        <Aside>
          {oldest ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <span className="hidden sm:inline">ECB · updated </span>
                  {formatDate(oldest)}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {status.data.job.lastSuccessAt
                  ? `Checked ${formatDateTime(status.data.job.lastSuccessAt)}`
                  : "Not checked yet"}
              </TooltipContent>
            </Tooltip>
          ) : (
            "ECB · no rates yet"
          )}
        </Aside>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={refresh.isPending || status.data.job.running}
        onClick={() => refresh.mutate()}
      >
        {(refresh.isPending || status.data.job.running) && <Spinner />}
        Update now
      </Button>
    </SettingsRow>
  )
}

function PublicAddressRow({ settings }: { settings: Settings }) {
  const save = useSaveSettings()
  const [value, setValue] = useState(settings.publicUrl)
  const [failed, setFailed] = useState(false)
  const commit = () => {
    if (value.trim() === settings.publicUrl) return
    save.mutate(
      { publicUrl: value },
      {
        onSuccess: (s) => {
          setValue(s.publicUrl)
          setFailed(false)
        },
        onError: () => setFailed(true),
      }
    )
  }
  return (
    <SettingsRow title="Public address" htmlFor="public-url">
      <Input
        id="public-url"
        className={CONTROL}
        inputMode="url"
        spellCheck={false}
        autoComplete="off"
        placeholder={
          typeof window === "undefined" ? "" : window.location.origin
        }
        value={value}
        aria-invalid={failed || undefined}
        onChange={(e) => {
          setValue(e.target.value)
          setFailed(false)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") setValue(settings.publicUrl)
        }}
      />
    </SettingsRow>
  )
}

function ExportRow() {
  return (
    <SettingsRow title="Export">
      <Button variant="outline" size="sm" asChild>
        <a href="/api/export/transactions" download>
          Download CSV
        </a>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <a href="/api/export/database" download>
          Download database
        </a>
      </Button>
    </SettingsRow>
  )
}

function SignOutRow() {
  return (
    <SettingsRow title="Session">
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await api("/session", { method: "DELETE" })
          window.location.href = "/login"
        }}
      >
        Sign out
      </Button>
    </SettingsRow>
  )
}
