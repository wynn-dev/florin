import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Headline, ReportFrame, useChartHeight } from "./report-frame"
import { ReportTable } from "./report-table"
import type { ReportColumn } from "./report-table"
import type { Conversion, NetWorthAccount, ReportQuery } from "@/shared/reports"
import { AreaTrend } from "@/components/charts"
import { Money } from "@/components/money"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { queries } from "@/lib/api"
import { formatDate, formatMoney, formatPercent } from "@/lib/format"

const SECTIONS = [
  { label: "Cash", rows: (a: NetWorthAccount) => a.group === "cash" },
  { label: "Credit", rows: (a: NetWorthAccount) => a.group === "credit" },
  {
    label: "Investments",
    rows: (a: NetWorthAccount) => a.group === "investments",
  },
]

export function NetWorthReport({
  query,
  currency,
}: {
  query: ReportQuery
  currency: string
}) {
  const result = useQuery({
    ...queries.netWorth(query),
    placeholderData: keepPreviousData,
  })
  const height = useChartHeight()
  return (
    <ReportFrame query={result}>
      {(report) => {
        const last = report.points.at(-1)!
        const startTotal = sum(report.accounts.map((a) => a.start ?? 0))
        const change = last.netWorth - startTotal
        return (
          <>
            <Headline
              label={`Net worth on ${formatDate(last.date)}`}
              value={formatMoney(last.netWorth, currency)}
              detail={
                <>
                  {formatMoney(change, currency, { signed: true })}
                  {startTotal > 0 &&
                    ` (${formatPercent(change / startTotal, { signed: true, digits: 1 })})`}{" "}
                  since {formatDate(report.from)}
                  {report.missingRates && " · waiting for exchange rates"}
                </>
              }
            />
            <AreaTrend
              data={report.points.map((p) => ({
                ...p,
                // Month ends tick as their month ("Nov"), days as dates.
                x: report.step === "month" ? p.date.slice(0, 7) : p.date,
              }))}
              x="x"
              // Scaled to the figures, as the account value chart is: from
              // zero a growing net worth reads as a flat line.
              baseline="auto"
              // A month or more ticks once a month; a few weeks tick by date.
              xFormat={
                report.step === "day" && report.points.length < 45
                  ? "date"
                  : "month"
              }
              tooltipLabel={(x) =>
                formatDate(
                  report.points.find((p) => p.date.startsWith(String(x)))!.date
                )
              }
              series={[{ key: "netWorth", label: "Net worth" }]}
              currency={currency}
              height={height}
              endLabel
              tooltipExtra={(row) => [
                { label: "Assets", value: formatMoney(row.assets, currency) },
                {
                  label: "Liabilities",
                  value: formatMoney(row.liabilities, currency),
                },
                {
                  label: `Since ${formatDate(report.from)}`,
                  value: formatMoney(row.netWorth - startTotal, currency, {
                    signed: true,
                  }),
                },
              ]}
            />
            <ReportTable
              rows={report.accounts}
              rowKey={(a) => a.id}
              sections={SECTIONS}
              defaultSort={{ id: "end", desc: true }}
              columns={columns(currency)}
            />
          </>
        )
      }}
    </ReportFrame>
  )
}

function columns(currency: string): ReportColumn<NetWorthAccount>[] {
  const total = (pick: (a: NetWorthAccount) => number | null) =>
    function Total(rows: NetWorthAccount[]) {
      return (
        <Money
          cents={sum(rows.map((r) => pick(r) ?? 0))}
          currency={currency}
          symbol={false}
        />
      )
    }
  return [
    {
      id: "name",
      header: "Account",
      value: (a) => a.name,
      cell: (a) => (
        <>
          {a.name}
          {a.currency !== currency && (
            <span className="text-muted-foreground"> · {a.currency}</span>
          )}
        </>
      ),
    },
    {
      id: "start",
      header: `Start · ${currency}`,
      value: (a) => a.start,
      cell: (a) => (
        <Converted
          value={a.start}
          conversion={a.startConversion}
          currency={currency}
          own={a.currency}
        />
      ),
      total: total((a) => a.start),
    },
    {
      id: "end",
      header: `End · ${currency}`,
      value: (a) => a.end,
      cell: (a) => (
        <Converted
          value={a.end}
          conversion={a.endConversion}
          currency={currency}
          own={a.currency}
        />
      ),
      total: total((a) => a.end),
    },
    {
      id: "change",
      header: `Change · ${currency}`,
      value: (a) => a.change,
      cell: (a) =>
        a.change === null ? (
          <span className="text-muted-foreground">–</span>
        ) : (
          formatMoney(a.change, currency, { signed: true, symbol: false })
        ),
      total: (rows) =>
        formatMoney(sum(rows.map((r) => r.change ?? 0)), currency, {
          signed: true,
          symbol: false,
        }),
    },
  ]
}

/** A budget-currency cell; for another currency, its own amount and rate on hover. */
function Converted({
  value,
  conversion,
  currency,
  own,
}: {
  value: number | null
  conversion: Conversion | null
  currency: string
  own: string
}) {
  if (value === null)
    return <span className="text-muted-foreground">No rate yet</span>
  const text = <Money cents={value} currency={currency} symbol={false} />
  if (!conversion) return text
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default underline decoration-muted-foreground/40 decoration-dotted underline-offset-4">
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent className="tabular-nums">
        {formatMoney(conversion.amount, own)} at {conversion.rate.toFixed(4)},
        ECB {formatDate(conversion.rateDate)}
      </TooltipContent>
    </Tooltip>
  )
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
