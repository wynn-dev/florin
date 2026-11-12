import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Brand } from "@/components/setup/brand"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api"

/** Sign-in for a florin that has its password. A fresh one goes to /setup. */
export const Route = createFileRoute("/login")({ component: Login })

function Login() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const signIn = useMutation({
    mutationFn: () => api("/session", { method: "POST", body: { password } }),
    onSuccess: async () => {
      await router.invalidate()
      await router.navigate({ to: "/" })
    },
  })
  const wrong = signIn.isError || undefined
  return (
    <main className="grid min-h-svh place-items-center p-6">
      <form
        className="flex w-full max-w-xs flex-col gap-8"
        onSubmit={(e) => {
          e.preventDefault()
          if (password) signIn.mutate()
        }}
      >
        <Brand />
        <div className="flex flex-col gap-4">
          <Field data-invalid={wrong}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              aria-invalid={wrong}
              onChange={(e) => {
                setPassword(e.target.value)
                signIn.reset()
              }}
            />
            {signIn.error && (
              <FieldError>
                {signIn.error.message === "wrong password"
                  ? "Wrong password"
                  : signIn.error.message}
              </FieldError>
            )}
          </Field>
          <Button type="submit" disabled={signIn.isPending}>
            {signIn.isPending && <Spinner />}
            Sign in
          </Button>
        </div>
      </form>
    </main>
  )
}
