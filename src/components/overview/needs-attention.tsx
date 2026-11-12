import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { toast } from "sonner"
import { live } from "./live"
import type { AttentionItem } from "@/shared/attention"
import { QueryState } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { api, queries } from "@/lib/api"

/**
 * Up to five things for the person: theirs first (renew a bank's access, fix
 * a failed sync), then what agents haven't got to in a day. One action each.
 */
export function NeedsAttention() {
  const query = useQuery({ ...queries.attention(), ...live })
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Needs attention</h2>
      <QueryState
        query={query}
        skeleton={
          <div className="flex flex-col gap-3 py-1" aria-hidden>
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        }
      >
        {({ items }) =>
          items.length ? (
            <ul className="-mx-2 flex flex-col">
              {items.map((item) => (
                <Row key={item.id} item={item} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing needs you right now.
            </p>
          )
        }
      </QueryState>
    </section>
  )
}

function Row({ item }: { item: AttentionItem }) {
  return (
    <li className="flex min-h-10 items-center gap-3 rounded-md px-2 py-1.5 text-sm">
      {item.who === "person" && (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-negative"
        />
      )}
      <span className="min-w-0 flex-1 text-pretty">{item.text}</span>
      <Action item={item} />
    </li>
  )
}

function Action({ item }: { item: AttentionItem }) {
  const client = useQueryClient()
  const { action } = item
  const run = useMutation({
    mutationFn: (path: string) =>
      api<{ url?: string } | undefined>(path.replace(/^\/api/, ""), {
        method: "POST",
      }),
    onSuccess: (answer) => {
      if (answer && typeof answer === "object" && answer.url)
        window.location.href = answer.url
    },
    onError: (error, path) =>
      toast.error(`${action.label} failed: ${error.message}`, {
        action: { label: "Retry", onClick: () => run.mutate(path) },
      }),
    onSettled: () => client.invalidateQueries(),
  })

  if ("post" in action)
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0"
        disabled={run.isPending}
        onClick={() => run.mutate(action.post)}
      >
        {run.isPending && <Spinner />}
        {action.label}
      </Button>
    )
  return (
    <Button variant="outline" size="sm" className="h-7 shrink-0" asChild>
      <Link
        to={action.to as never}
        search={action.search as never}
        hash={action.hash}
      >
        {action.label}
      </Link>
    </Button>
  )
}
