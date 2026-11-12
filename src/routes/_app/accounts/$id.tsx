import { createFileRoute, notFound } from "@tanstack/react-router"
import { queries } from "@/lib/api"
import { AccountPage } from "@/components/accounts/account-page"
import { accountQueries } from "@/components/accounts/queries"

function accountId(param: string): number {
  const n = Number(param)
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound()
  return n
}

export const Route = createFileRoute("/_app/accounts/$id")({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(
        accountQueries.account(accountId(params.id))
      ),
      context.queryClient.ensureQueryData(queries.settings()),
    ]).catch(() => undefined),
  component: Account,
})

function Account() {
  const id = accountId(Route.useParams().id)
  return <AccountPage key={id} id={id} />
}
