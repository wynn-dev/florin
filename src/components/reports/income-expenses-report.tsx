import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Headline, ReportFrame, useChartHeight } from "./report-frame"
import { ReportTable } from "./report-table"
import type { ReportColumn } from "./report-table"
import type { IncomeExpenseMonth, ReportQuery } from "@/shared/reports"
import { Bars } from "@/components/charts"
import { Money } from "@/components/money"
import { queries } from "@/lib/api"
import {
  firstDay,
  formatMoney,
  formatMonth,
  formatPercent,
  lastDay,
} from "@/lib/format"

/** Income and expenses side by side per month; a click opens that month's transactions. */
export function IncomeExpensesReport({
  query,
  currency,
}: {
  query: ReportQuery
  currency: string
}) {
  const result = useQuery({
    ...queries.incomeExpenses(query),
    placeholderData: keepPreviousData,
  })
  const navigate = useNavigate()
  const height = useChartHeight()
  const open = (row: IncomeExpenseMonth) =>
    void navigate({
      to: "/transactions",
      search: { from: firstDay(row.month), to: lastDay(row.month) } as never,
    })
  return (
    <ReportFrame query={result}>
      {(report) => {
        const income = sum(report.months.map((m) => m.income))
        const net = sum(report.months.map((m) => m.net))
        return (
          <>
            <Headline
              label={net >= 0 ? "Saved" : "Spent more than earned"}
              value={formatMoney(Math.abs(net), currency)}
              detail={
                income > 0
                  ? `${formatPercent(net / income)} of ${formatMoney(income, currency)} income`
                  : "No income in this range"
              }
            />
            <Bars
              data={report.months}
              category="month"
              series={[
                { key: "income", label: "Income" },
                { key: "expenses", label: "Expenses" },
              ]}
              currency={currency}
              height={height}
              labelLast
              tooltipExtra={(row) => [
                {
                  label: "Net",
                  value: formatMoney(row.net, currency, { signed: true }),
                },
              ]}
              onBarClick={open}
            />
            <ReportTable
              rows={report.months}
              rowKey={(m) => m.month}
              defaultSort={{ id: "month", desc: true }}
              columns={columns(currency)}
              onRowClick={open}
              rowLabel={(m) => `Transactions in ${formatMonth(m.month)}`}
            />
          </>
        )
      }}
    </ReportFrame>
  )
}

function columns(currency: string): ReportColumn<IncomeExpenseMonth>[] {
  const money = (pick: (m: IncomeExpenseMonth) => number, signed = false) => ({
    value: pick,
    cell: (m: IncomeExpenseMonth) =>
      signed ? (
        formatMoney(pick(m), currency, { signed, symbol: false })
      ) : (
        <Money cents={pick(m)} currency={currency} symbol={false} />
      ),
    total: (rows: IncomeExpenseMonth[]) =>
      formatMoney(sum(rows.map(pick)), currency, { signed, symbol: false }),
  })
  return [
    {
      id: "month",
      header: "Month",
      value: (m) => m.month,
      cell: (m) => formatMonth(m.month),
    },
    { id: "income", header: `Income · ${currency}`, ...money((m) => m.income) },
    {
      id: "expenses",
      header: `Expenses · ${currency}`,
      ...money((m) => m.expenses),
    },
    { id: "net", header: `Net · ${currency}`, ...money((m) => m.net, true) },
    {
      id: "savingsRate",
      header: "Savings rate",
      value: (m) => m.savingsRate,
      cell: (m) =>
        m.savingsRate === null ? (
          <span className="text-muted-foreground">–</span>
        ) : (
          formatPercent(m.savingsRate)
        ),
      total: (rows) => {
        const income = sum(rows.map((r) => r.income))
        return income ? formatPercent(sum(rows.map((r) => r.net)) / income) : ""
      },
    },
  ]
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
