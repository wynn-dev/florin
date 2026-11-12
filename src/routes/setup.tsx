import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { SetupStatus } from "@/shared/setup"
import { Brand } from "@/components/setup/brand"
import {
  AccountsStep,
  AssistantStep,
  CategoriesStep,
  PasswordStep,
} from "@/components/setup/steps"
import { SectionError } from "@/components/states"
import { Skeleton } from "@/components/ui/skeleton"
import { queries } from "@/lib/api"

type Step = 1 | 2 | 3 | 4

/**
 * First run, shown until a password exists: /setup, then /setup?step=2…4 for
 * the steps that apply to this florin (one with data skips what it has).
 */
export const Route = createFileRoute("/setup")({
  validateSearch: (
    search: Record<string, unknown>
  ): { step?: Step; link?: number; linkError?: string } => {
    // Back from the bank after "Connect a bank" in step 2: stay on step 2
    // with ?link / ?linkError, so the bank dialog asks which account to link.
    const link = Number(search.link) || undefined
    const linkError =
      typeof search.linkError === "string" ? search.linkError : undefined
    if (link || linkError) return { step: 2, link, linkError }
    const step = Number(search.step)
    return step >= 2 && step <= 4 ? { step: step as Step } : {}
  },
  component: Setup,
})

// Which steps this run shows, fixed when it starts, for "Step 2 of 3".
const PLAN_KEY = "florin-setup-steps"

function applies(step: Step, status: SetupStatus): boolean {
  if (step === 2) return status.accounts === 0
  if (step === 3) return status.categoriesReplaceable
  if (step === 4) return status.mcpTokens === 0
  return status.needsSetup
}

function planFor(status: SetupStatus): Step[] {
  return [1, ...([2, 3, 4] as Step[]).filter((s) => applies(s, status))]
}

function readPlan(): Step[] {
  try {
    const plan = JSON.parse(sessionStorage.getItem(PLAN_KEY) ?? "null")
    if (Array.isArray(plan)) return plan as Step[]
  } catch {
    // Fall through to every step.
  }
  return [1, 2, 3, 4]
}

function Setup() {
  const { step: requested } = Route.useSearch()
  const navigate = useNavigate()
  const status = useQuery({ ...queries.setup(), staleTime: 0 })
  const step: Step | null = status.data?.needsSetup ? 1 : (requested ?? null)

  // Signed in with nothing left to set up: the dashboard.
  useEffect(() => {
    if (status.data && step === null) void navigate({ to: "/", replace: true })
  }, [status.data, step, navigate])

  /** The next step that still applies, or Overview. */
  const next = async (from: Step) => {
    const fresh = (await status.refetch()).data
    const plan = readPlan()
    const following = plan.filter((s) => s > from)
    const to = following.find((s) => !fresh || applies(s, fresh))
    if (to) await navigate({ to: "/setup", search: { step: to } })
    else {
      sessionStorage.removeItem(PLAN_KEY)
      await navigate({ to: "/" })
    }
  }

  // On step 1 the plan comes from what this florin has; later from the run.
  const plan = step === 1 && status.data ? planFor(status.data) : readPlan()
  const index = step ? plan.indexOf(step) : -1

  return (
    <main className="flex min-h-svh flex-col items-center px-4 py-10 sm:py-16">
      <div className="flex w-full max-w-md flex-col gap-8">
        <Brand />
        {status.isError ? (
          <SectionError onRetry={() => void status.refetch()} />
        ) : !status.data || step === null ? (
          <Skeleton className="h-96 rounded-xl" />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Step {index >= 0 ? index + 1 : step} of{" "}
              {index >= 0 ? plan.length : 4}
            </p>
            {step === 1 && (
              <PasswordStep
                status={status.data}
                onDone={() => {
                  sessionStorage.setItem(PLAN_KEY, JSON.stringify(plan))
                  void next(1)
                }}
              />
            )}
            {step === 2 && <AccountsStep onDone={() => void next(2)} />}
            {step === 3 && <CategoriesStep onDone={() => void next(3)} />}
            {step === 4 && <AssistantStep onDone={() => void next(4)} />}
          </div>
        )}
      </div>
    </main>
  )
}
