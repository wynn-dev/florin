import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Page } from "@/components/page"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { queries } from "@/lib/api"
import { formatDate, formatMoney } from "@/lib/format"

type Search = { accountId?: number; search?: string }

export const Route = createFileRoute("/_app/transactions")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    accountId: s.accountId === undefined ? undefined : Number(s.accountId),
    search: typeof s.search === "string" && s.search ? s.search : undefined,
  }),
  component: Transactions,
})

function Transactions() {
  const filter = Route.useSearch()
  const navigate = Route.useNavigate()
  const page = useQuery(queries.transactions({ ...filter, limit: 100 }))
  const accounts = useQuery(queries.accounts())
  const account = accounts.data?.find((a) => a.id === filter.accountId)
  const currency = (id: number) =>
    accounts.data?.find((a) => a.id === id)?.currency ?? "EUR"

  return (
    <Page
      title={account ? account.name : "Transactions"}
      actions={
        <Input
          placeholder="Search"
          className="w-56"
          defaultValue={filter.search}
          onChange={(e) =>
            void navigate({
              search: { ...filter, search: e.target.value || undefined },
              replace: true,
            })
          }
        />
      }
    >
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Date</TableHead>
              {!account && <TableHead>Account</TableHead>}
              <TableHead>Payee</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="pr-4 text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.data?.items.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="pl-4 text-muted-foreground tabular-nums">
                  {formatDate(t.date)}
                </TableCell>
                {!account && <TableCell>{t.accountName}</TableCell>}
                <TableCell className="font-medium">
                  {t.transferAccountName
                    ? `Transfer · ${t.transferAccountName}`
                    : t.payeeName}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {t.categoryName}
                </TableCell>
                <TableCell className="pr-4 text-right tabular-nums">
                  {formatMoney(t.amount, currency(t.accountId))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {page.data && (
        <p className="text-xs text-muted-foreground">
          Showing {page.data.items.length} of {page.data.total}
        </p>
      )}
    </Page>
  )
}
