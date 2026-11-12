// Settings › Connections › MCP, also setup's last step: the endpoint, the
// access tokens, and a new token shown once with the client config around it.
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckIcon, CopyIcon } from "lucide-react"
import { toast } from "sonner"
import type { CreatedMcpToken, McpToken } from "@/shared/mcp"
import { Aside, SettingsRow, SettingsSection } from "@/components/settings/row"
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api, queries } from "@/lib/api"
import { formatDate, formatDateTime, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

/** The address MCP clients use: the public address (else this page's) + /mcp. */
export function useMcpUrl(): string | undefined {
  const settings = useQuery(queries.settings())
  const [origin, setOrigin] = useState<string>()
  useEffect(() => setOrigin(window.location.origin), [])
  if (!settings.data || !origin) return undefined
  return `${settings.data.publicUrl || origin}/mcp`
}

/** The client config with the token filled in, in the shape the README gives. */
export function mcpConfig(url: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        florin: {
          type: "http",
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2
  )
}

export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return [
    copied,
    (text) =>
      void copyText(text).then(
        () => setCopied(true),
        () => toast.error("Couldn't copy. Select the text and copy it instead.")
      ),
  ]
}

/**
 * Copies text. The Clipboard API exists only on https and localhost, so a
 * florin reached over plain http on the network falls back to execCommand.
 */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // Fall through to the old way.
  }
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand("copy")
  area.remove()
  if (!ok) throw new Error("copy failed")
}

/** A read-only value with a copy button: an address, a token. */
export function CopyField({
  value,
  label,
  className,
  mono = false,
}: {
  value: string
  label: string
  className?: string
  mono?: boolean
}) {
  const [copied, copy] = useCopy()
  return (
    <InputGroup className={className}>
      <InputGroupInput
        readOnly
        value={value}
        aria-label={label}
        className={cn("truncate", mono && "font-mono text-[13px]")}
        onFocus={(e) => e.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          onClick={() => copy(value)}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

/** A code block with a copy button in its corner. */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, copy] = useCopy()
  return (
    <div className="relative rounded-lg border bg-muted/40">
      <pre className="p-3 pr-10 font-mono text-[12px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
        {code}
      </pre>
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute top-2 right-2 text-muted-foreground"
        onClick={() => copy(code)}
        aria-label={`Copy ${label}`}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}

export function McpEndpointRow() {
  const url = useMcpUrl()
  return (
    <SettingsRow title="Endpoint">
      {url ? (
        <CopyField value={url} label="Endpoint" className="w-52 sm:w-72" />
      ) : (
        <Skeleton className="h-8 w-52 sm:w-72" />
      )}
    </SettingsRow>
  )
}

/** The whole MCP section of Settings › Connections. */
export function McpSettings() {
  const tokens = useQuery(queries.mcpTokens())
  const [creating, setCreating] = useState(false)
  return (
    <SettingsSection id="mcp" title="MCP">
      <McpEndpointRow />
      <SettingsRow title="Access tokens">
        {tokens.data?.items.length === 0 && <Aside>None yet</Aside>}
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          New token
        </Button>
      </SettingsRow>
      {tokens.data ? (
        tokens.data.items.map((t) => <TokenRow key={t.id} token={t} />)
      ) : (
        <Skeleton className="my-3 h-8" />
      )}
      <NewTokenDialog open={creating} onOpenChange={setCreating} />
    </SettingsSection>
  )
}

function TokenRow({ token }: { token: McpToken }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const revoke = useMutation({
    mutationFn: () => api(`/mcp-tokens/${token.id}`, { method: "DELETE" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queries.mcpTokens().queryKey }),
    onError: (error) => toast.error(error.message),
  })
  return (
    <SettingsRow
      title={<span className="truncate pl-4 font-normal">{token.name}</span>}
      className="min-h-12 py-2"
    >
      <span className="hidden truncate text-sm text-muted-foreground sm:inline">
        Created {formatDate(token.createdAt.slice(0, 10))}
        {" · "}
        {token.lastUsedAt ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>Last used {formatRelative(token.lastUsedAt)}</span>
            </TooltipTrigger>
            <TooltipContent>{formatDateTime(token.lastUsedAt)}</TooltipContent>
          </Tooltip>
        ) : (
          "Never used"
        )}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="-mr-2.5"
        onClick={() => setConfirming(true)}
        disabled={revoke.isPending}
      >
        Revoke
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {token.name}'s token?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops working immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => revoke.mutate()}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsRow>
  )
}

function NewTokenDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [created, setCreated] = useState<CreatedMcpToken | null>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setTimeout(() => setCreated(null), 200)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{created ? created.name : "New token"}</DialogTitle>
        </DialogHeader>
        {created ? (
          <>
            <CreatedToken token={created} />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <NewTokenForm
            onCreated={setCreated}
            footer={(pending) => (
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending && <Spinner />}
                  Create
                </Button>
              </DialogFooter>
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Name → [Create]. The name is the source name Activity shows. */
export function NewTokenForm({
  onCreated,
  footer,
  autoFocus = true,
  inline = false,
}: {
  onCreated: (token: CreatedMcpToken) => void
  footer: (pending: boolean) => React.ReactNode
  autoFocus?: boolean
  /** The button beside the field instead of under it. */
  inline?: boolean
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const create = useMutation({
    mutationFn: () =>
      api<CreatedMcpToken>("/mcp-tokens", { method: "POST", body: { name } }),
    onSuccess: (token) => {
      void queryClient.invalidateQueries({
        queryKey: queries.mcpTokens().queryKey,
      })
      void queryClient.invalidateQueries({ queryKey: queries.setup().queryKey })
      onCreated(token)
    },
  })
  const input = (
    <Input
      id="token-name"
      autoFocus={autoFocus}
      autoComplete="off"
      placeholder="Claude Desktop"
      value={name}
      maxLength={60}
      aria-invalid={create.isError || undefined}
      onChange={(e) => {
        setName(e.target.value)
        create.reset()
      }}
    />
  )
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <Field data-invalid={create.isError || undefined}>
        <FieldLabel htmlFor="token-name">Token name</FieldLabel>
        {inline ? (
          <div className="flex gap-2">
            {input}
            {footer(create.isPending)}
          </div>
        ) : (
          input
        )}
        {create.error && (
          <FieldError>{capitalise(create.error.message)}</FieldError>
        )}
      </Field>
      {!inline && footer(create.isPending)}
    </form>
  )
}

/** The token, shown this once, and the config to paste into the client. */
export function CreatedToken({ token }: { token: CreatedMcpToken }) {
  const url = useMcpUrl()
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="created-token">
          Shown once. Copy it now.
        </FieldLabel>
        <CopyField value={token.token} label="Token" mono />
      </Field>
      {url && (
        <Field>
          <FieldLabel>Client config</FieldLabel>
          <CodeBlock code={mcpConfig(url, token.token)} label="client config" />
        </Field>
      )}
    </div>
  )
}

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
