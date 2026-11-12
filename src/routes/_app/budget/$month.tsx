import { createFileRoute, notFound } from "@tanstack/react-router"
import { queries } from "@/lib/api"
import { BudgetPage } from "@/components/budget/budget-page"

export const Route = createFileRoute("/_app/budget/$month")({
  beforeLoad: ({ params }) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(params.month)) throw notFound()
  },
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(queries.budget(params.month)),
      context.queryClient.ensureQueryData(queries.settings()),
    ]).catch(() => undefined),
  component: Budget,
})

function Budget() {
  const { month } = Route.useParams()
  return <BudgetPage month={month} />
}
