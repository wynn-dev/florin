import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Headline, ReportFrame, useChartHeight } from "./report-frame"
import { ReportTable } from "./report-table"
import type { ReportColumn } from "./report-table"
import type { CashFlowMonth, ReportQuery } from "@/shared/reports"
import { Bars } from "@/components/charts"
import { Money } from "@/components/money"
import { queries } from "@/lib/api"
import { formatDate, formatMoney, formatMonth } from "@/lib/format"

/** Net money into the cash accounts per month, above or below zero, with their balances. */
export function CashFlowReport({
  query,
  currency,
}: {
  query: ReportQuery
  currency: string
}) {
  const result = useQuery({
    ...queries.cashFlow(query),
    placeholderData: keepPreviousData,
  })
  const height = useChartHeight()
  return (
    <ReportFrame query={result}>
      {(report) => {
        const net = sum(report.months.map((m) => m.net))
        const first = report.months[0]
        const last = report.months.at(-1)!
        return (
          <>
            <Headline
              label="Net cash flow"
              value={formatMoney(net, currency, { signed: true })}
              detail={`Cash accounts ${formatMoney(first.starting, currency)} on ${formatDate(report.from)}, ${formatMoney(last.ending, currency)} on ${formatDate(report.to)}`}
            />
            <Bars
              data={report.months}
              category="month"
              series={[{ key: "net", label: "Net" }]}
              currency={currency}
              variant="diverging"
              height={height}
              tooltipExtra={(row) => [
                { label: "In", value: formatMoney(row.inflow, currency) },
                { label: "Out", value: formatMoney(row.outflow, currency) },
                {
                  label: "Ending balance",
                  value: formatMoney(row.ending, currency),
                },
              ]}
            />
            <ReportTable
              rows={report.months}
              rowKey={(m) => m.month}
              defaultSort={{ id: "month", desc: true }}
              columns={columns(currency)}
            />
          </>
        )
      }}
    </ReportFrame>
  )
}

function columns(currency: string): ReportColumn<CashFlowMonth>[] {
  const money = (
    id: keyof CashFlowMonth,
    header: string,
    total?: (rows: CashFlowMonth[]) => number,
    signed = false
  ): ReportColumn<CashFlowMonth> => ({
    id,
    header: `${header} · ${currency}`,
    value: (m) => m[id],
    cell: (m) =>
      signed ? (
        formatMoney(m[id] as number, currency, { signed, symbol: false })
      ) : (
        <Money cents={m[id] as number} currency={currency} symbol={false} />
      ),
    total:
      total &&
      ((rows) => formatMoney(total(rows), currency, { signed, symbol: false })),
  })
  // Totals: the first month's start, the flows summed, the last month's end.
  const byMonth = (rows: CashFlowMonth[]) =>
    [...rows].sort((a, b) => a.month.localeCompare(b.month))
  return [
    {
      id: "month",
      header: "Month",
      value: (m) => m.month,
      cell: (m) => formatMonth(m.month),
    },
    money("starting", "Starting", (rows) => byMonth(rows)[0].starting),
    money("inflow", "In", (rows) => sum(rows.map((r) => r.inflow))),
    money("outflow", "Out", (rows) => sum(rows.map((r) => r.outflow))),
    money("net", "Net", (rows) => sum(rows.map((r) => r.net)), true),
    money("ending", "Ending", (rows) => byMonth(rows).at(-1)!.ending),
  ]
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
