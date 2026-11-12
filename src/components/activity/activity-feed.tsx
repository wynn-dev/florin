import { useEffect, useRef, useState } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { api, queries } from "@/lib/api"
import {
  formatDate,
  formatDateTime,
  formatDayHeading,
  formatMonth,
  formatRelative,
  formatTime,
  today,
} from "@/lib/format"
import { Money } from "@/components/money"
import { SourceLabel } from "@/components/source-label"
import { EmptyState, SectionError } from "@/components/states"
import { payeeText, transferText } from "@/components/transactions/parts"
import { qs } from "@/components/transactions/queries"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { LIVE, activityQueries, toActivityFilter } from "./queries"
import type { ActivitySearch } from "./queries"
import type { ActivityEntry } from "@/shared/activity"
import type { TransactionPage } from "@/shared/types"

/**
 * The latest Activity entries, newest first, as on Overview: who changed
 * what, each expandable to the rows it touched. Refetches every 30 s and on
 * focus so agents' changes appear. No heading or "View all": the host adds
 * those.
 */
export function ActivityFeed({ limit = 8 }: { limit?: number }) {
  const feed = useQuery({ ...activityQueries.recent(limit), ...LIVE })
  if (!feed.data) {
    return feed.isError ? (
      <SectionError
        onRetry={() => void feed.refetch()}
        retrying={feed.isFetching}
      />
    ) : (
      <FeedSkeleton rows={Math.min(limit, 8)} />
    )
  }
  if (!feed.data.items.length)
    return <EmptyState title="No changes yet" className="py-8" />
  return (
    <div className="flex flex-col">
      {feed.data.items.map((entry) => (
        <ActivityRow key={entry.id} entry={entry} />
      ))}
    </div>
  )
}

/** /activity's list: every entry under sticky day headings, loading more as it scrolls. */
export function ActivityLog({
  search,
  onClear,
}: {
  search: ActivitySearch
  onClear: () => void
}) {
  const filtered = Object.values(search).some((v) => v !== undefined)
  const log = useInfiniteQuery({
    ...activityQueries.entries(toActivityFilter(search)),
    ...LIVE,
  })
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = log
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const observer = new IntersectionObserver(
      ([hit]) => {
        if (hit.isIntersecting && !isFetchingNextPage) void fetchNextPage()
      },
      { rootMargin: "600px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (!log.data)
    return log.isError ? (
      <SectionError
        message="Couldn't load activity."
        onRetry={() => void log.refetch()}
        retrying={log.isFetching}
      />
    ) : (
      <FeedSkeleton rows={12} />
    )

  const entries = log.data.pages.flatMap((p) => p.items)
  if (!entries.length)
    return filtered ? (
      <EmptyState title="No changes match these filters" className="flex-none">
        <Button variant="outline" onClick={onClear}>
          Clear filters
        </Button>
      </EmptyState>
    ) : (
      <EmptyState title="No changes yet" className="flex-none" />
    )

  const days: { day: string; entries: ActivityEntry[] }[] = []
  for (const entry of entries) {
    const day = today(new Date(entry.at))
    if (days.at(-1)?.day !== day) days.push({ day, entries: [] })
    days.at(-1)!.entries.push(entry)
  }
  return (
    <div className="flex flex-col">
      {days.map(({ day, entries: dayEntries }) => (
        <section key={day}>
          <h2 className="sticky top-0 z-10 bg-background/95 py-2 text-xs font-medium text-muted-foreground backdrop-blur">
            {formatDayHeading(day)}
          </h2>
          {dayEntries.map((entry) => (
            <ActivityRow key={entry.id} entry={entry} clock />
          ))}
        </section>
      ))}
      <div ref={sentinel} className="flex h-12 items-center justify-center">
        {isFetchingNextPage && <Skeleton className="h-3 w-24" />}
      </div>
    </div>
  )
}

function FeedSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-4">
          <Skeleton className="h-3.5 w-14" />
          <Skeleton
            className="h-3.5"
            style={{ width: `${30 + ((i * 13) % 30)}%` }}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * Summaries come from the server with ISO dates and months ("on 2026-11-10",
 * "in 2026-11"); show them as the rest of the dashboard does.
 */
export function readable(summary: string): string {
  return summary
    .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_, d: string) => formatDate(d))
    .replace(/\b(\d{4}-\d{2})\b/g, (_, m: string) => formatMonth(m))
}

/**
 * One entry: time, "Claude Desktop categorised 23 transactions", and a
 * chevron that expands it to the rows it touched as they are now.
 * `clock` shows the time of day (the full log groups by day); otherwise the
 * time is relative.
 */
export function ActivityRow({
  entry,
  clock = false,
}: {
  entry: ActivityEntry
  clock?: boolean
}) {
  const [open, setOpen] = useState(false)
  // A lone line is the summary itself: nothing more to show.
  const expandable = entry.transactions > 0 || entry.lineCount > 1
  const time = clock ? formatTime(entry.at) : formatRelative(entry.at)

  const line = (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="w-12 shrink-0 text-muted-foreground tabular-nums md:w-16">
            {time}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          {formatDateTime(entry.at)}
        </TooltipContent>
      </Tooltip>
      <span className="line-clamp-2 min-w-0 flex-1 md:truncate">
        <SourceLabel actor={entry.actor} /> {readable(entry.summary)}
      </span>
    </>
  )

  if (!expandable)
    return (
      <div className="flex min-h-12 items-center gap-4 border-b border-border/60 py-2 text-sm last:border-0 md:h-12 md:py-0">
        {line}
        <span className="size-4 shrink-0" />
      </div>
    )

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-b border-border/60 last:border-0"
    >
      <CollapsibleTrigger className="group/row flex min-h-12 w-full items-center gap-4 rounded-md py-2 text-left text-sm outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 md:h-12 md:py-0">
        {line}
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/row:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <EntryDetail entry={entry} />
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The rows an entry touched, as they are now, then its other lines. */
function EntryDetail({ entry }: { entry: ActivityEntry }) {
  const rows = useQuery({
    queryKey: ["transactions", "change", entry.id],
    queryFn: () =>
      api<TransactionPage>(
        `/transactions${qs({ change: entry.id, limit: 10 })}`
      ),
    enabled: entry.transactions > 0,
  })
  const accounts = useQuery(queries.accounts()).data
  const budgetCurrency = useQuery(queries.settings()).data?.currency
  const currency = (id: number) =>
    accounts?.find((a) => a.id === id)?.currency ?? budgetCurrency ?? "EUR"

  return (
    <div className="flex max-w-3xl flex-col gap-3 pt-1 pb-4 text-sm md:pl-20">
      {entry.transactions > 0 &&
        (rows.data ? (
          <div className="flex flex-col">
            {rows.data.items.map((t) => (
              <div
                key={t.id}
                className="grid h-9 grid-cols-[3.5rem_minmax(0,1fr)_6rem] items-center gap-3 border-b border-border/60 last:border-0 md:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,10rem)_7rem]"
              >
                <span className="text-muted-foreground tabular-nums">
                  {t.status === "pending" ? "Pending" : formatDate(t.date)}
                </span>
                <span className="truncate">{payeeText(t)}</span>
                <span className="hidden truncate text-muted-foreground md:block">
                  {transferText(t) ?? t.categoryName ?? "Uncategorised"}
                </span>
                <Money
                  cents={t.amount}
                  currency={currency(t.accountId)}
                  signed
                  symbol={currency(t.accountId) !== budgetCurrency}
                  className="text-right"
                />
              </div>
            ))}
            {rows.data.total > rows.data.items.length && (
              <Link
                to="/transactions"
                search={{ change: entry.id }}
                className="pt-2 text-sm font-medium underline-offset-4 hover:underline"
              >
                Show all {rows.data.total} in Transactions
              </Link>
            )}
          </div>
        ) : rows.isError ? (
          <SectionError
            className="min-h-12 justify-start"
            onRetry={() => void rows.refetch()}
          />
        ) : (
          <Skeleton className="h-9 w-full" />
        ))}
      {(entry.lineCount > 1 ||
        (entry.lineCount > 0 && entry.transactions > 0)) && (
        <ul className={cn("flex flex-col gap-1.5 text-muted-foreground")}>
          {entry.lines.map((l, i) => (
            <li key={i}>{readable(l)}</li>
          ))}
          {entry.lineCount > entry.lines.length && (
            <li>and {entry.lineCount - entry.lines.length} more</li>
          )}
        </ul>
      )}
    </div>
  )
}
