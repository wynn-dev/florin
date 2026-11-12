import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ebQueries, setCredentials } from "./api"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import type { SetCredentials } from "@/shared/enablebanking"

/**
 * The Enable Banking application id and/or private key, checked with Enable
 * Banking when saved; what's wrong shows under the form. The key is pasted
 * or read from the .pem file in the browser and sent once; it never comes back.
 */
export function CredentialsForm({
  fields,
  onDone,
  onCancel,
  submitLabel = "Save",
}: {
  fields: "both" | "appId" | "privateKey"
  onDone?: () => void
  onCancel?: () => void
  submitLabel?: string
}) {
  const queryClient = useQueryClient()
  const [appId, setAppId] = useState("")
  const [privateKey, setPrivateKey] = useState("")
  const [fileName, setFileName] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const save = useMutation({
    mutationFn: (input: SetCredentials) => setCredentials(input),
    onSuccess: (status) => {
      queryClient.setQueryData(ebQueries.status().queryKey, status)
      onDone?.()
    },
  })
  const wantsId = fields !== "privateKey"
  const wantsKey = fields !== "appId"
  const ready =
    (!wantsId || appId.trim() !== "") && (!wantsKey || privateKey.trim() !== "")

  const readFile = async (f: File | undefined) => {
    if (!f) return
    setPrivateKey(await f.text())
    setFileName(f.name)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        save.mutate({
          ...(wantsId ? { appId: appId.trim() } : {}),
          ...(wantsKey ? { privateKey } : {}),
        })
      }}
    >
      <FieldGroup className="gap-4">
        {wantsId && (
          <Field>
            <FieldLabel htmlFor="eb-app-id">Application ID</FieldLabel>
            <Input
              id="eb-app-id"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
              className="font-mono text-xs"
            />
          </Field>
        )}
        {wantsKey && (
          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="eb-private-key">Private key</FieldLabel>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => file.current?.click()}
              >
                {fileName ?? "Upload .pem"}
              </Button>
              <input
                ref={file}
                type="file"
                accept=".pem,.key,text/plain"
                className="hidden"
                onChange={(e) => void readFile(e.target.files?.[0])}
              />
            </div>
            <Textarea
              id="eb-private-key"
              value={fileName ? "" : privateKey}
              onChange={(e) => {
                setFileName(null)
                setPrivateKey(e.target.value)
              }}
              placeholder={
                fileName ? `${fileName} loaded` : "-----BEGIN PRIVATE KEY-----"
              }
              spellCheck={false}
              autoComplete="off"
              className="h-24 resize-none font-mono text-xs"
            />
          </Field>
        )}
        {save.error && <FieldError>{save.error.message}</FieldError>}
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={!ready || save.isPending}>
            {save.isPending && <Spinner />}
            {submitLabel}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
