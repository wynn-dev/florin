import { useQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { AccountsList } from "@/components/overview/accounts-list"
import { live } from "@/components/overview/live"
import { NeedsAttention } from "@/components/overview/needs-attention"
import { NetWorth } from "@/components/overview/net-worth"
import { ActivityFeed } from "@/components/activity/activity-feed"
import { ConnectBankDialog } from "@/components/connections/enable-banking/connect-bank-dialog"
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
            <Link to="/accounts" search={{ add: "choose" }}>
              Add account
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/accounts" search={{ add: "bank" }}>
              Connect a bank
            </Link>
          </Button>
        </EmptyState>
      </Page>
    )

  // Two columns on a desktop: the charts at the left; at the right what
  // needs the person and what agents changed, above the fold, then accounts.
  // On a phone one column: net worth, this month and Needs attention,
  // recent activity, spending, accounts ("contents" lets each card take its
  // own place in that order).
  return (
    <Page title="Overview">
      {currency && (
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:items-start">
          <div className="contents lg:col-span-8 lg:flex lg:flex-col lg:gap-6">
            <div className="order-1">
              <NetWorth currency={currency} />
            </div>
            <div className="order-4">
              <SpendingThisMonth currency={currency} />
            </div>
          </div>
          <div className="contents lg:col-span-4 lg:flex lg:flex-col lg:gap-6">
            <Card className="order-2 gap-0 py-5 shadow-none">
              <CardContent className="flex flex-col gap-5 px-5">
                <ThisMonth currency={currency} />
                <Separator />
                <NeedsAttention />
              </CardContent>
            </Card>
            <Card className="order-3 gap-0 pt-5 pb-2 shadow-none">
              <CardContent className="flex flex-col gap-1 px-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium">Recent activity</h2>
                  <Link
                    to="/activity"
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    View all
                  </Link>
                </div>
                <ActivityFeed limit={6} compact />
              </CardContent>
            </Card>
            <div className="order-5">
              <AccountsList currency={currency} />
            </div>
          </div>
        </div>
      )}
      {/* Renew in Needs attention comes back here from the bank. */}
      <ConnectBankDialog open={false} onOpenChange={() => {}} />
    </Page>
  )
}
