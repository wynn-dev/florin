import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Headline, ReportFrame } from "./report-frame"
import { ReportTable } from "./report-table"
import type { ReportColumn } from "./report-table"
import type {
  ReportQuery,
  SpendingGroup,
  SpendingReport as Report,
} from "@/shared/reports"
import { Bars } from "@/components/charts"
import { Money } from "@/components/money"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { queries } from "@/lib/api"
import { formatMoney, formatPercent } from "@/lib/format"

/** A bar and a table row: a group at the top, a category once drilled in. */
type Row = {
  key: string
  /** The group's id at the top level (0 for uncategorised), the category's id inside a group. */
  id: number | null
  name: string
  amount: number
  previous: number
  share: number
  perMonth: number
}

/**
 * Spending by group, largest first; a click on a group shows its
 * categories, and a click on a category opens its transactions for the
 * range. `group` is the drilled-into group from the URL.
 */
export function SpendingReport({
  query,
  currency,
  group,
  onGroup,
}: {
  query: ReportQuery
  currency: string
  group: number | undefined
  onGroup: (group: number | undefined) => void
}) {
  const result = useQuery({
    ...queries.spending(query),
    placeholderData: keepPreviousData,
  })
  const navigate = useNavigate()
  return (
    <ReportFrame query={result}>
      {(report) => {
        const drilled =
          group === undefined
            ? undefined
            : report.groups.find((g) => (g.groupId ?? 0) === group)
        const rows = drilled ? categoryRows(report, drilled) : groupRows(report)
        const total = drilled ? drilled.amount : report.total
        // Comparing with a period florin has no (or only part of the) data for misleads.
        const comparable = report.dataFrom! <= report.previousFrom
        const open = (row: Row) => {
          if (!drilled) return onGroup(row.id ?? 0)
          void navigate({
            to: "/transactions",
            search: (row.id === null
              ? { uncategorized: true, from: report.from, to: report.to }
              : {
                  categoryIds: [row.id],
                  from: report.from,
                  to: report.to,
                }) as never,
          })
        }
        return (
          <>
            <Headline
              label={drilled ? `Spent on ${drilled.name}` : "Spent"}
              value={formatMoney(total, currency)}
              detail={
                <>
                  {formatMoney(Math.round(total / report.months), currency)} a
                  month on average
                  {comparable &&
                    ` · ${vsPrevious(
                      total,
                      drilled ? drilled.previous : report.previousTotal,
                      currency
                    )}`}
                </>
              }
            />
            <div className="flex flex-col gap-3">
              <Breadcrumb>
                <BreadcrumbList>
                  {drilled ? (
                    <>
                      <BreadcrumbItem>
                        <BreadcrumbLink asChild>
                          <button
                            type="button"
                            onClick={() => onGroup(undefined)}
                          >
                            All groups
                          </button>
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbPage>{drilled.name}</BreadcrumbPage>
                      </BreadcrumbItem>
                    </>
                  ) : (
                    <BreadcrumbItem>
                      <BreadcrumbPage>All groups</BreadcrumbPage>
                    </BreadcrumbItem>
                  )}
                </BreadcrumbList>
              </Breadcrumb>
              <Bars
                data={rows.filter((r) => r.amount > 0)}
                category="name"
                series={[{ key: "amount", label: "Spent" }]}
                currency={currency}
                variant="ranked"
                tooltipLabel={(name) => String(name)}
                tooltipExtra={(row) => [
                  { label: "Share", value: share(row.share) },
                  {
                    label: "Per month",
                    value: formatMoney(row.perMonth, currency),
                  },
                ]}
                onBarClick={open}
              />
            </div>
            <ReportTable
              rows={rows}
              rowKey={(r) => r.key}
              defaultSort={{ id: "amount", desc: true }}
              columns={columns(
                currency,
                drilled ? "Category" : "Group",
                comparable
              )}
              onRowClick={open}
              rowLabel={(r) =>
                drilled
                  ? `Transactions for ${r.name}`
                  : `Categories in ${r.name}`
              }
            />
          </>
        )
      }}
    </ReportFrame>
  )
}

function groupRows(report: Report): Row[] {
  return report.groups.map((g) => ({
    key: `g${g.groupId ?? 0}`,
    id: g.groupId ?? 0,
    name: g.name,
    amount: g.amount,
    previous: g.previous,
    share: report.total ? g.amount / report.total : 0,
    perMonth: Math.round(g.amount / report.months),
  }))
}

function categoryRows(report: Report, group: SpendingGroup): Row[] {
  return group.categories.map((c) => ({
    key: `c${c.categoryId ?? 0}`,
    id: c.categoryId,
    name: c.name,
    amount: c.amount,
    previous: c.previous,
    share: report.total ? c.amount / report.total : 0,
    perMonth: Math.round(c.amount / report.months),
  }))
}

function vsPrevious(now: number, before: number, currency: string): string {
  if (!before) return "nothing in the period before"
  const diff = now - before
  if (!diff) return "the same as the period before"
  return `${formatMoney(Math.abs(diff), currency)} ${diff > 0 ? "more" : "less"} than the period before`
}

function columns(
  currency: string,
  first: string,
  comparable: boolean
): ReportColumn<Row>[] {
  const sum = (rows: Row[], pick: (r: Row) => number) =>
    rows.reduce((s, r) => s + pick(r), 0)
  const change: ReportColumn<Row>[] = [
    {
      id: "change",
      header: `Vs period before · ${currency}`,
      value: (r) => r.amount - r.previous,
      cell: (r) =>
        formatMoney(r.amount - r.previous, currency, {
          signed: true,
          symbol: false,
        }),
      total: (rows) =>
        formatMoney(
          sum(rows, (r) => r.amount - r.previous),
          currency,
          {
            signed: true,
            symbol: false,
          }
        ),
    },
  ]
  return [
    { id: "name", header: first, value: (r) => r.name },
    {
      id: "amount",
      header: `Spent · ${currency}`,
      value: (r) => r.amount,
      cell: (r) => (
        <Money cents={r.amount} currency={currency} symbol={false} />
      ),
      total: (rows) => (
        <Money
          cents={sum(rows, (r) => r.amount)}
          currency={currency}
          symbol={false}
        />
      ),
    },
    {
      id: "share",
      header: "Of total",
      value: (r) => r.share,
      cell: (r) => share(r.share),
      total: (rows) => formatPercent(sum(rows, (r) => r.share)),
    },
    {
      id: "perMonth",
      header: "Per month",
      value: (r) => r.perMonth,
      cell: (r) => (
        <Money cents={r.perMonth} currency={currency} symbol={false} />
      ),
      total: (rows) => (
        <Money
          cents={sum(rows, (r) => r.perMonth)}
          currency={currency}
          symbol={false}
        />
      ),
    },
    ...(comparable ? change : []),
  ]
}

/** "16%", or "6.3%" under ten percent. */
function share(ratio: number): string {
  return formatPercent(ratio, { digits: ratio < 0.1 ? 1 : 0 })
}
