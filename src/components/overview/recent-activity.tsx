// A stand-in for the activity feed (src/components/activity/) until it lands:
// the latest changes from /api/activity in the feed's row design. Replace
// with <ActivityFeed limit={8} /> once that is on main.
import { useQuery } from "@tanstack/react-query"
import { live } from "./live"
import type { Change } from "@/shared/types"
import { SourceLabel } from "@/components/source-label"
import { EmptyState, QueryState, SkeletonRows } from "@/components/states"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { queries } from "@/lib/api"
import { formatDateTime, formatRelative } from "@/lib/format"

export function RecentActivity({ limit = 8 }: { limit?: number }) {
  const query = useQuery({ ...queries.activity(limit), ...live })
  return (
    <QueryState query={query} skeleton={<SkeletonRows rows={limit} />}>
      {({ items }) =>
        items.length ? (
          <ul className="flex flex-col">
            {items.map((change) => (
              <Row key={change.id} change={change} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No changes yet." className="py-8" />
        )
      }
    </QueryState>
  )
}

function Row({ change }: { change: Change }) {
  return (
    <li className="flex min-h-12 items-center gap-4 border-b py-2 text-sm last:border-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <time
            dateTime={change.at}
            className="w-16 shrink-0 text-muted-foreground tabular-nums sm:w-20"
          >
            {formatRelative(change.at)}
          </time>
        </TooltipTrigger>
        <TooltipContent>{formatDateTime(change.at)}</TooltipContent>
      </Tooltip>
      <p className="line-clamp-2 min-w-0 flex-1 sm:truncate">
        <SourceLabel actor={change.actor} />{" "}
        {change.summary.charAt(0).toLowerCase() + change.summary.slice(1)}
      </p>
    </li>
  )
}
