import { Link, useRouterState } from "@tanstack/react-router"
import { ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"
import { PhoneMenu } from "@/components/bottom-bar"
import { SidebarTrigger } from "@/components/ui/sidebar"

/**
 * The bar at the top of every page: the sidebar trigger (⌘B), the page's
 * title, and the page's actions at the right. On a phone, Overview also gets
 * the ⋯ menu that holds Settings.
 */
export function SiteHeader({
  title,
  parent,
  actions,
}: {
  title: string
  /** A breadcrumb before the title: "Overview › Activity". */
  parent?: { label: string; to: string }
  actions?: ReactNode
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 px-4 md:h-16 md:px-6">
      <SidebarTrigger className="-ml-2 hidden text-muted-foreground md:inline-flex" />
      <h1 className="flex min-w-0 items-center gap-1.5 text-xl font-semibold tracking-tight">
        {parent && (
          <>
            <Link
              to={parent.to}
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              {parent.label}
            </Link>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate">{title}</span>
      </h1>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {actions}
        {pathname === "/" && <PhoneMenu className="md:hidden" />}
      </div>
    </header>
  )
}
