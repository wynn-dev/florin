import { useQuery } from "@tanstack/react-query"
import { AccountMenu } from "./account-menu"
import { InvestmentAccount } from "./investment"
import { accountQueries } from "./queries"
import { ConnectionLine } from "./connection"
import type { Account } from "@/shared/types"
import { formatMoney } from "@/lib/format"
import { AreaTrend } from "@/components/charts"
import { TransactionsTable } from "@/components/transactions/transactions-table"
import { Page } from "@/components/page"
import {
  QueryState,
  SkeletonChart,
  SkeletonFigure,
  SkeletonRows,
} from "@/components/states"

/** /accounts/$id: a cash, credit or loan account, or an investment account's own page. */
export function AccountPage({ id }: { id: number }) {
  const account = useQuery(accountQueries.account(id))
  const values = useQuery(accountQueries.values(id))
  const holdings = useQuery(accountQueries.holdings(id))
  const a = account.data
  const investment =
    a?.type === "investment" &&
    (a.provider === "ibkr" || !!values.data?.length || !!holdings.data?.length)

  return (
    <Page title={a?.name ?? ""} actions={a && <AccountMenu account={a} />}>
      <QueryState
        query={account}
        error="Couldn't load this account."
        skeleton={
          <div className="flex flex-col gap-6">
            <SkeletonFigure />
            <SkeletonChart height={160} />
            <SkeletonRows rows={8} />
          </div>
        }
      >
        {(data) =>
          investment ? (
            <InvestmentAccount account={data} />
          ) : (
            <BankAccount account={data} />
          )
        }
      </QueryState>
    </Page>
  )
}

function BankAccount({ account }: { account: Account }) {
  const balances = useQuery(accountQueries.balances(account.id))
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-4xl font-semibold tracking-tight">
          {formatMoney(account.balance, account.currency)}
        </span>
        <ConnectionLine account={account} />
      </div>
      <QueryState
        query={balances}
        skeleton={<SkeletonChart height={160} />}
        error="Couldn't load the balance history."
      >
        {(points) =>
          points.length > 1 ? (
            <AreaTrend
              data={points}
              x="date"
              series={[{ key: "value", label: "Balance" }]}
              currency={account.currency}
              height={160}
            />
          ) : null
        }
      </QueryState>
      <TransactionsTable accountId={account.id} />
    </div>
  )
}
