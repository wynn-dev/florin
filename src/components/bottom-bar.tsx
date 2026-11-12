// The phone's navigation: a fixed bar with the five places, and the ⋯ menu
// at the right of Overview's header with sync state, Settings and the theme.
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { EllipsisIcon } from "lucide-react"
import { NAV, THEMES, isActive } from "@/components/app-sidebar"
import {
  StatusDot,
  syncSummary,
  useConnections,
} from "@/components/sync-status"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTheme } from "@/lib/theme"
import type { Theme } from "@/lib/theme"
import { cn } from "@/lib/utils"

export function BottomBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden">
      <ul className="grid h-14 grid-cols-5">
        {NAV.map((item) => {
          const active = isActive(item.to, pathname)
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors",
                  active && "text-foreground"
                )}
              >
                <item.icon
                  className="size-5"
                  strokeWidth={active ? 2.25 : 1.75}
                />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function PhoneMenu({ className }: { className?: string }) {
  const navigate = useNavigate()
  const [theme, setTheme] = useTheme()
  const summary = syncSummary(useConnections())
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={className}>
          <EllipsisIcon />
          <span className="sr-only">More</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {summary && (
          <>
            <DropdownMenuItem
              onSelect={() =>
                void navigate({
                  to: "/settings",
                  search: { section: "connections" },
                })
              }
            >
              <span
                className={cn(
                  "flex items-center gap-2",
                  summary.tone === "ok" && "text-muted-foreground",
                  summary.tone === "warning" && "text-warning",
                  summary.tone === "negative" && "text-negative"
                )}
              >
                <StatusDot tone={summary.tone} />
                {summary.text}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => void navigate({ to: "/settings" })}>
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(v) => setTheme(v as Theme)}
        >
          {THEMES.map((t) => (
            <DropdownMenuRadioItem key={t.value} value={t.value}>
              {t.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
