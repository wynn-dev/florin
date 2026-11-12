import { useQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { Page } from "@/components/page"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { queries } from "@/lib/api"
import { formatMoney } from "@/lib/format"

export const Route = createFileRoute("/_app/accounts")({ component: Accounts })

function Accounts() {
  const accounts = useQuery(queries.accounts())
  return (
    <Page title="Accounts">
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead />
              <TableHead className="pr-4 text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.data?.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="pl-4 font-medium">
                  <Link
                    to="/transactions"
                    search={{ accountId: a.id }}
                    className="hover:underline"
                  >
                    {a.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground capitalize">
                  {a.type}
                </TableCell>
                <TableCell className="flex gap-1.5">
                  {!a.onBudget && <Badge variant="secondary">Tracking</Badge>}
                  {a.closed && <Badge variant="outline">Closed</Badge>}
                </TableCell>
                <TableCell className="pr-4 text-right tabular-nums">
                  {formatMoney(a.balance, a.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Page>
  )
}
