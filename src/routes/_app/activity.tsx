import { createFileRoute } from "@tanstack/react-router"
import { Page } from "@/components/page"
import { ActivityLog } from "@/components/activity/activity-feed"
import { ActivityFilters } from "@/components/activity/activity-filters"
import { ACTIVITY_KINDS } from "@/shared/activity"
import type { ActivitySearch } from "@/components/activity/queries"
import type { ActivityKind } from "@/shared/activity"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const Route = createFileRoute("/_app/activity")({
  validateSearch: (raw: Record<string, unknown>): ActivitySearch => ({
    source:
      typeof raw.source === "string" && raw.source ? raw.source : undefined,
    kind: ACTIVITY_KINDS.includes(raw.kind as ActivityKind)
      ? (raw.kind as ActivityKind)
      : undefined,
    from:
      typeof raw.from === "string" && ISO_DATE.test(raw.from)
        ? raw.from
        : undefined,
    to:
      typeof raw.to === "string" && ISO_DATE.test(raw.to) ? raw.to : undefined,
    entry:
      Number.isSafeInteger(Number(raw.entry)) && Number(raw.entry) > 0
        ? Number(raw.entry)
        : undefined,
  }),
  component: Activity,
})

function Activity() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const set = (next: ActivitySearch) =>
    void navigate({ search: next, replace: true })
  return (
    <Page title="Activity" parent={{ label: "Overview", to: "/" }}>
      <ActivityFilters search={search} onChange={set} />
      <ActivityLog search={search} onClear={() => set({})} />
    </Page>
  )
}
