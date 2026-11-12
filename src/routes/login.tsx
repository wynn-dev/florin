import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"

export const Route = createFileRoute("/login")({ component: Login })

type Session = { signedIn: boolean; needsSetup: boolean }

function Login() {
  const navigate = useNavigate()
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("/session"),
  })
  const setup = session.data?.needsSetup ?? false

  const form = useForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value, formApi }) => {
      try {
        await api<Session>("/session", { method: "POST", body: value })
        await navigate({ to: "/" })
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: { fields: { password: (error as Error).message } },
        })
      }
    },
  })

  return (
    <main className="grid min-h-svh place-items-center p-6">
      <form
        className="flex w-full max-w-xs flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">florin</h1>
          <p className="text-sm text-muted-foreground">
            {setup
              ? "Choose a password for this dashboard."
              : "Sign in to your budget."}
          </p>
        </div>
        <form.Field
          name="password"
          validators={{
            onSubmit: ({ value }) =>
              setup && value.length < 8 ? "At least 8 characters" : undefined,
          }}
        >
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor={field.name}>Password</Label>
              <Input
                id={field.name}
                type="password"
                autoFocus
                autoComplete={setup ? "new-password" : "current-password"}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors.length > 0 && (
                <p className="text-sm text-destructive">
                  {field.state.meta.errors.join(", ")}
                </p>
              )}
            </div>
          )}
        </form.Field>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => (
            <Button type="submit" disabled={submitting || session.isPending}>
              {setup ? "Set password" : "Sign in"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </main>
  )
}
