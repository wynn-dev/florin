import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { api, queries } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { importCsv, invalidateAfterEdit, previewCsv, qs } from "./queries"
import type { CsvPreview } from "@/shared/import"
import type { CsvMapping, TransactionPage } from "@/shared/types"

type Step = "file" | "map" | "review"

/**
 * CSV import in three steps: the file and the account; the columns (florin
 * guesses them) with the first rows; then "214 new, 12 already in florin"
 * and Import, with Undo in the toast.
 */
export function ImportCsvDialog({
  open,
  onOpenChange,
  accountId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preselects the account, e.g. from an account's ⋯ › Import CSV. */
  accountId?: number
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 gap-0 p-0 sm:max-w-3xl">
        {open && (
          <ImportFlow
            defaultAccountId={accountId}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ImportFlow({
  defaultAccountId,
  onDone,
}: {
  defaultAccountId?: number
  onDone: () => void
}) {
  const client = useQueryClient()
  const accounts = (useQuery(queries.accounts()).data ?? []).filter(
    (a) => !a.closed && a.type !== "investment"
  )
  const [step, setStep] = useState<Step>("file")
  const [accountId, setAccountId] = useState(defaultAccountId)
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const read = useMutation({
    mutationFn: (input: { mapping?: CsvMapping }) =>
      previewCsv(accountId!, file!.text, input.mapping),
    onSuccess: (next) => {
      setPreview(next)
      setError(null)
    },
    onError: (e) => setError(e.message),
  })

  const undo = useMutation({
    mutationFn: async (change: number) => {
      // Pages are at most 1000 rows; an import can be far bigger.
      const ids: number[] = []
      for (let total = Infinity; ids.length < total;) {
        const page = await api<TransactionPage>(
          `/transactions${qs({ change, limit: 1000, offset: ids.length })}`
        )
        if (!page.items.length) break
        ids.push(...page.items.map((t) => t.id))
        total = page.total
      }
      if (ids.length)
        await api<void>("/transactions", { method: "DELETE", body: { ids } })
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => invalidateAfterEdit(client),
  })

  const run = useMutation({
    mutationFn: () =>
      importCsv(accountId!, file!.text, preview!.mapping, file!.name),
    onSuccess: (result) => {
      invalidateAfterEdit(client)
      onDone()
      const already = result.skipped
        ? ` · ${result.skipped} already in florin`
        : ""
      toast(
        `Imported ${result.added} ${result.added === 1 ? "transaction" : "transactions"}${already}`,
        result.change
          ? {
              action: {
                label: "Undo",
                onClick: () => undo.mutate(result.change!),
              },
            }
          : undefined
      )
    },
    onError: (e) => setError(e.message),
  })

  const remap = (patch: Partial<CsvMapping>) => {
    if (!preview) return
    const mapping = { ...preview.mapping, ...patch }
    setPreview({ ...preview, mapping })
    read.mutate({ mapping })
  }

  return (
    <>
      <DialogHeader className="px-6 pt-5 pb-4">
        <DialogTitle className="text-base">Import CSV</DialogTitle>
        <p className="text-sm text-muted-foreground">
          {step === "file"
            ? "Step 1 of 3"
            : step === "map"
              ? "Step 2 of 3"
              : "Step 3 of 3"}
        </p>
      </DialogHeader>

      <div className="min-w-0 px-6 pb-6">
        {step === "file" && (
          <div className="flex flex-col gap-5">
            <DropZone
              file={file?.name ?? null}
              onFile={(name, text) => {
                setFile({ name, text })
                setPreview(null)
                setError(null)
              }}
            />
            <Field>
              <FieldLabel htmlFor="import-account">Into account</FieldLabel>
              <Select
                value={accountId?.toString() ?? ""}
                onValueChange={(v) => {
                  setAccountId(Number(v))
                  setPreview(null)
                }}
              >
                <SelectTrigger id="import-account" className="w-full sm:w-72">
                  <SelectValue placeholder="Account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id.toString()}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}

        {step === "map" && preview && (
          <MapColumns preview={preview} onChange={remap} />
        )}

        {step === "review" && preview && (
          <div className="flex flex-col gap-1.5 pt-2 pb-4">
            <p className="text-2xl font-semibold tabular-nums">
              {preview.added} new
              {preview.skipped ? (
                <span className="text-muted-foreground">
                  , {preview.skipped} already in florin
                </span>
              ) : null}
            </p>
            <p className="text-sm text-muted-foreground">
              {file?.name} into {accounts.find((a) => a.id === accountId)?.name}
              {preview.skipped ? ", skipping what's already there" : ""}
            </p>
          </div>
        )}
      </div>

      <DialogFooter className="mx-0 mb-0 flex-row items-center rounded-b-xl border-t bg-muted/40 px-6 py-3 sm:justify-between">
        <span role="alert" className="min-w-0 truncate text-sm text-negative">
          {error ?? (step === "map" ? preview?.error : null)}
        </span>
        <div className="flex shrink-0 gap-2">
          {step !== "file" && (
            <Button
              variant="outline"
              onClick={() => setStep(step === "review" ? "map" : "file")}
            >
              Back
            </Button>
          )}
          {step === "file" && (
            <Button
              disabled={!file || accountId === undefined || read.isPending}
              onClick={() =>
                read.mutate(
                  { mapping: preview?.mapping },
                  { onSuccess: () => setStep("map") }
                )
              }
            >
              {read.isPending && <Spinner />}
              Next
            </Button>
          )}
          {step === "map" && (
            <Button
              disabled={!preview || preview.added === null || read.isPending}
              onClick={() => setStep("review")}
            >
              {read.isPending && <Spinner />}
              Next
            </Button>
          )}
          {step === "review" &&
            (preview?.added ? (
              <Button disabled={run.isPending} onClick={() => run.mutate()}>
                {run.isPending && <Spinner />}
                Import {preview.added}
              </Button>
            ) : (
              <Button onClick={onDone}>Done</Button>
            ))}
        </div>
      </DialogFooter>
    </>
  )
}

function DropZone({
  file,
  onFile,
}: {
  file: string | null
  onFile: (name: string, text: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const take = async (f: File | undefined) => {
    if (f) onFile(f.name, await f.text())
  }
  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        void take(e.dataTransfer.files[0])
      }}
      className={cn(
        "flex h-36 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-foreground/20 text-sm transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50",
        over && "border-foreground/40 bg-muted/50"
      )}
    >
      {file ? (
        <>
          <span className="font-medium">{file}</span>
          <span className="text-muted-foreground">Choose another file</span>
        </>
      ) : (
        <>
          <span className="font-medium">Drop a CSV file here</span>
          <span className="text-muted-foreground">or choose one</span>
        </>
      )}
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={(e) => void take(e.target.files?.[0])}
      />
    </button>
  )
}

const NONE = "__none"

function ColumnSelect({
  id,
  label,
  value,
  headers,
  optional,
  onChange,
}: {
  id: string
  label: string
  value: string | undefined
  headers: string[]
  optional?: boolean
  onChange: (value: string | undefined) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value || NONE}
        onValueChange={(v) => onChange(v === NONE ? undefined : v)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {optional && <SelectItem value={NONE}>None</SelectItem>}
          {headers.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function MapColumns({
  preview,
  onChange,
}: {
  preview: CsvPreview
  onChange: (patch: Partial<CsvMapping>) => void
}) {
  const { mapping, headers } = preview
  const split = !mapping.amount && !!(mapping.inflow || mapping.outflow)
  const roles = new Map<string, string>()
  const role = (name: string | undefined, as: string) => {
    if (name) roles.set(name, as)
  }
  role(mapping.date, "Date")
  role(mapping.payee, "Payee")
  role(mapping.notes, "Memo")
  if (split) {
    role(mapping.inflow, "In")
    role(mapping.outflow, "Out")
  } else role(mapping.amount, "Amount")

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
        <ColumnSelect
          id="map-date"
          label="Date"
          value={mapping.date}
          headers={headers}
          onChange={(date) => onChange({ date: date ?? "" })}
        />
        <Field>
          <FieldLabel htmlFor="map-date-format">Date format</FieldLabel>
          <Select
            value={mapping.dateFormat ?? "YYYY-MM-DD"}
            onValueChange={(v) =>
              onChange({ dateFormat: v as CsvMapping["dateFormat"] })
            }
          >
            <SelectTrigger id="map-date-format" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(
                [
                  "YYYY-MM-DD",
                  "DD/MM/YYYY",
                  "MM/DD/YYYY",
                  "DD.MM.YYYY",
                ] as const
              ).map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <ColumnSelect
          id="map-payee"
          label="Payee"
          value={mapping.payee}
          headers={headers}
          optional
          onChange={(payee) => onChange({ payee: payee ?? "" })}
        />
        <ColumnSelect
          id="map-notes"
          label="Memo"
          value={mapping.notes}
          headers={headers}
          optional
          onChange={(notes) => onChange({ notes })}
        />
        <Field className="col-span-2 sm:col-span-1">
          <FieldLabel>Amount</FieldLabel>
          <ToggleGroup
            type="single"
            spacing={0}
            value={split ? "split" : "one"}
            onValueChange={(v) => {
              if (v === "split")
                onChange({
                  amount: undefined,
                  inflow: mapping.amount ?? headers[0],
                  outflow: mapping.amount ?? headers[0],
                })
              else if (v === "one")
                onChange({
                  amount: mapping.inflow ?? mapping.outflow ?? headers[0],
                  inflow: undefined,
                  outflow: undefined,
                })
            }}
            className="h-9 w-full rounded-md bg-muted p-0.5"
          >
            {(
              [
                ["one", "One column"],
                ["split", "In and out"],
              ] as const
            ).map(([value, text]) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="h-8 flex-1 rounded-[5px]! px-2 text-xs text-muted-foreground hover:bg-transparent data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs data-[state=on]:hover:bg-background"
              >
                {text}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        {split ? (
          <>
            <ColumnSelect
              id="map-in"
              label="In"
              value={mapping.inflow}
              headers={headers}
              optional
              onChange={(inflow) => onChange({ inflow })}
            />
            <ColumnSelect
              id="map-out"
              label="Out"
              value={mapping.outflow}
              headers={headers}
              optional
              onChange={(outflow) => onChange({ outflow })}
            />
          </>
        ) : (
          <ColumnSelect
            id="map-amount"
            label="Amount column"
            value={mapping.amount}
            headers={headers}
            onChange={(amount) => onChange({ amount })}
          />
        )}
        <Field>
          <FieldLabel htmlFor="map-decimal">Decimal mark</FieldLabel>
          <Select
            value={mapping.decimal ?? "."}
            onValueChange={(v) => onChange({ decimal: v as "." | "," })}
          >
            <SelectTrigger id="map-decimal" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=".">1,234.56</SelectItem>
              <SelectItem value=",">1.234,56</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              {headers.map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 align-bottom font-normal whitespace-nowrap"
                >
                  <span className="block text-xs text-muted-foreground">
                    {roles.get(h) ?? " "}
                  </span>
                  <span
                    className={cn(
                      roles.has(h) ? "font-medium" : "text-muted-foreground"
                    )}
                  >
                    {h}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.sample.map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                {headers.map((h, j) => (
                  <td
                    key={h}
                    className={cn(
                      "max-w-56 truncate px-3 py-2 whitespace-nowrap tabular-nums",
                      !roles.has(h) && "text-muted-foreground"
                    )}
                  >
                    {row[j]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground tabular-nums">
        {preview.rows} {preview.rows === 1 ? "row" : "rows"} in the file
      </p>
    </div>
  )
}
