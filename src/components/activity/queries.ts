// Activity's queries. Agents' changes appear on their own: the feed refetches
// every 30 s and when the window regains focus, and never toasts.
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { addDays } from "@/lib/format"
import { qs } from "@/components/transactions/queries"
import type { Actor } from "@/shared/types"
import type {
  ActivityFilter,
  ActivityKind,
  ActivityPage,
} from "@/shared/activity"

export const LIVE = { refetchInterval: 30_000, refetchOnWindowFocus: true }

/** /activity's filters, as its URL keeps them: dates are local days. */
export type ActivitySearch = {
  source?: string
  kind?: ActivityKind
  from?: string
  to?: string
}

/** Local days to the API's timestamps: from the start of `from` to the end of `to`. */
export function toActivityFilter(search: ActivitySearch): ActivityFilter {
  const midnight = (date: string) => new Date(`${date}T00:00:00`).toISOString()
  return {
    source: search.source,
    kind: search.kind,
    from: search.from ? midnight(search.from) : undefined,
    to: search.to ? midnight(addDays(search.to, 1)) : undefined,
  }
}

export const activityQueries = {
  recent: (limit: number) =>
    queryOptions({
      queryKey: ["activity", "entries", "recent", limit],
      queryFn: () => api<ActivityPage>(`/activity${qs({ limit })}`),
    }),
  entries: (filter: ActivityFilter) =>
    infiniteQueryOptions({
      queryKey: ["activity", "entries", filter],
      queryFn: ({ pageParam }) =>
        api<ActivityPage>(
          `/activity${qs({ ...filter, limit: 50, before: pageParam })}`
        ),
      initialPageParam: undefined as number | undefined,
      getNextPageParam: (last) => last.next ?? undefined,
    }),
  sources: () =>
    queryOptions({
      queryKey: ["activity", "sources"],
      queryFn: () => api<Actor[]>("/activity/sources"),
    }),
}
