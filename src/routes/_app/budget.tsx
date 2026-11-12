import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Page } from "@/components/page"
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
import { formatMoney, formatMonth } from "@/lib/format"

export const Route = createFileRoute("/_app/budget")({ component: Budget })

function Budget() {
  const month = new Date().toISOString().slice(0, 7)
  const currency = useQuery(queries.settings()).data?.currency ?? "EUR"
  const budget = useQuery(queries.budget(month))
  const money = (n: number) => formatMoney(n, currency)
  return (
    <Page
      title={formatMonth(month)}
      actions={
        budget.data && (
          <span className="text-sm text-muted-foreground">
            To budget{" "}
            <span className="font-medium text-foreground tabular-nums">
              {money(budget.data.toBudget)}
            </span>
          </span>
        )
      }
    >
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Category</TableHead>
              <TableHead className="text-right">Budgeted</TableHead>
              <TableHead className="text-right">Activity</TableHead>
              <TableHead className="pr-4 text-right">Available</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {budget.data?.groups.flatMap((g) => [
              <TableRow
                key={`g${g.id}`}
                className="bg-muted/40 hover:bg-muted/40"
              >
                <TableCell className="pl-4 font-medium">{g.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(g.budgeted)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(g.activity)}
                </TableCell>
                <TableCell className="pr-4 text-right tabular-nums">
                  {money(g.available)}
                </TableCell>
              </TableRow>,
              ...g.categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-8">{c.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(c.budgeted)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {money(c.activity)}
                  </TableCell>
                  <TableCell
                    className={`pr-4 text-right tabular-nums ${c.available < 0 ? "text-destructive" : ""}`}
                  >
                    {money(c.available)}
                  </TableCell>
                </TableRow>
              )),
            ])}
          </TableBody>
        </Table>
      </Card>
    </Page>
  )
}
