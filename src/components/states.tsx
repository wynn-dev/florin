import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

/**
 * A page or section with nothing in it yet: a title, an optional line under
 * it, and up to three buttons ("No transactions yet" [Add one] [Import CSV]).
 * No icon or illustration.
 */
export function EmptyState({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  /** The actions, as Buttons; the first one should be the primary. */
  children?: ReactNode
  className?: string
}) {
  return (
    <Empty className={cn("py-12", className)}>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children && (
        <EmptyContent className="flex-row justify-center">
          {children}
        </EmptyContent>
      )}
    </Empty>
  )
}

/**
 * A section that failed on its own: "Couldn't load this. [Retry]". Pass the
 * query's refetch as onRetry; the button spins while it runs.
 */
export function SectionError({
  message = "Couldn't load this.",
  onRetry,
  retrying = false,
  className,
}: {
  message?: string
  onRetry?: () => void
  retrying?: boolean
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-24 flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-muted-foreground",
        className
      )}
    >
      <span>{message}</span>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying && <Spinner />}
          Retry
        </Button>
      )}
    </div>
  )
}

/**
 * Renders a TanStack Query's three states the same way everywhere: the
 * skeleton on first load only, SectionError with Retry on failure, then the
 * data. A refetch keeps showing the data.
 */
export function QueryState<T>({
  query,
  skeleton,
  error,
  children,
}: {
  query: {
    data: T | undefined
    isError: boolean
    isFetching: boolean
    refetch: () => unknown
  }
  skeleton: ReactNode
  /** The error line, e.g. "Couldn't load transactions." */
  error?: string
  children: (data: T) => ReactNode
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>
  if (query.isError)
    return (
      <SectionError
        message={error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  return <>{skeleton}</>
}

/** Skeleton list rows, 40px each like the real rows, with a right-aligned amount. */
export function SkeletonRows({
  rows = 5,
  className,
}: {
  rows?: number
  className?: string
}) {
  return (
    <div className={cn("flex flex-col", className)} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex h-10 items-center gap-4 border-b border-border/60"
        >
          <Skeleton
            className="h-3.5"
            style={{ width: `${28 + ((i * 17) % 30)}%` }}
          />
          <Skeleton className="ml-auto h-3.5 w-16" />
        </div>
      ))}
    </div>
  )
}

/** A skeleton the size of a chart, axis band included. */
export function SkeletonChart({
  height = 240,
  className,
}: {
  height?: number
  className?: string
}) {
  return (
    <Skeleton
      aria-hidden
      className={cn("w-full rounded-lg", className)}
      style={{ height }}
    />
  )
}

/** A skeleton for a figure: a short label line over a large number. */
export function SkeletonFigure({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden>
      <Skeleton className="h-3.5 w-20" />
      <Skeleton className="h-9 w-40" />
    </div>
  )
}
