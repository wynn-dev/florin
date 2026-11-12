import { createFileRoute } from "@tanstack/react-router"
import type { AddStep } from "@/components/accounts/add-account"
import { queries } from "@/lib/api"
import { AccountsList } from "@/components/accounts/accounts-list"

const STEPS: AddStep[] = ["choose", "bank", "ibkr", "manual"]

/** ?add=choose|bank|ibkr|manual opens Add account at that step. */
export const Route = createFileRoute("/_app/accounts/")({
  validateSearch: (s: Record<string, unknown>): { add?: AddStep } => ({
    add: STEPS.includes(s.add as AddStep) ? (s.add as AddStep) : undefined,
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(queries.accounts()),
      context.queryClient.ensureQueryData(queries.settings()),
    ]).catch(() => undefined),
  component: Accounts,
})

function Accounts() {
  const { add } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <AccountsList
      add={add ?? null}
      onAddChange={(step) =>
        void navigate({ search: { add: step ?? undefined }, replace: true })
      }
    />
  )
}
