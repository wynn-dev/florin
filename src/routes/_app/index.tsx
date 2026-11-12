import { useQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { AccountsList } from "@/components/overview/accounts-list"
import { live } from "@/components/overview/live"
import { NeedsAttention } from "@/components/overview/needs-attention"
import { NetWorth } from "@/components/overview/net-worth"
import { RecentActivity } from "@/components/overview/recent-activity"
import { SpendingThisMonth } from "@/components/overview/spending-this-month"
import { ThisMonth } from "@/components/overview/this-month"
import { Page } from "@/components/page"
import { EmptyState } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { queries } from "@/lib/api"

export const Route = createFileRoute("/_app/")({
  loader: ({ context: { queryClient } }) => {
    void queryClient.prefetchQuery(queries.settings())
    void queryClient.prefetchQuery(queries.accounts())
  },
  component: Overview,
})

/**
 * Where the person stands and what changed. Desktop: net worth beside this
 * month and Needs attention, then spending beside accounts, then recent
 * activity. Phone: one column, net worth, Needs attention, activity,
 * spending, accounts. Everything refetches on focus and every 30 s.
 */
function Overview() {
  const currency = useQuery(queries.settings()).data?.currency
  const accounts = useQuery({ ...queries.accounts(), ...live })

  if (accounts.data && !accounts.data.length)
    return (
      <Page title="Overview">
        <EmptyState title="Add an account to get started" className="py-24">
          <Button asChild>
            <Link to="/accounts" search={{ add: "choose" } as never}>
              Add account
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/accounts" search={{ add: "bank" } as never}>
              Connect a bank
            </Link>
          </Button>
        </EmptyState>
      </Page>
    )

  return (
    <Page title="Overview">
      {currency && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <NetWorth currency={currency} />
          </div>
          <Card className="gap-0 py-5 shadow-none lg:col-span-4">
            <CardContent className="flex flex-col gap-5 px-5">
              <ThisMonth currency={currency} />
              <Separator />
              <NeedsAttention />
            </CardContent>
          </Card>
          <div className="order-last lg:order-none lg:col-span-8">
            <SpendingThisMonth currency={currency} />
          </div>
          <div className="order-last lg:order-none lg:col-span-4">
            <AccountsList currency={currency} />
          </div>
          <section className="flex flex-col gap-2 lg:col-span-12">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Recent activity</h2>
              <Button
                variant="link"
                size="sm"
                className="h-auto px-0 text-muted-foreground hover:text-foreground"
                asChild
              >
                <Link to={"/activity" as never}>View all</Link>
              </Button>
            </div>
            <RecentActivity limit={8} />
          </section>
        </div>
      )}
    </Page>
  )
}
