import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  ArrowLeftRightIcon,
  ChartColumnIcon,
  HouseIcon,
  MonitorIcon,
  MoonIcon,
  PiggyBankIcon,
  RefreshCwIcon,
  SettingsIcon,
  SunIcon,
  WalletIcon,
} from "lucide-react"
import type { Account } from "@/shared/types"
import {
  ConnectionList,
  StatusDot,
  syncSummary,
  useConnections,
} from "@/components/sync-status"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { queries } from "@/lib/api"
import { formatMoney } from "@/lib/format"
import { useTheme } from "@/lib/theme"
import type { Theme } from "@/lib/theme"
import { cn } from "@/lib/utils"

/** The five places, in the sidebar and the phone's bottom bar. */
export const NAV = [
  { to: "/", label: "Overview", icon: HouseIcon },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRightIcon },
  { to: "/budget", label: "Budget", icon: PiggyBankIcon },
  { to: "/accounts", label: "Accounts", icon: WalletIcon },
  { to: "/reports", label: "Reports", icon: ChartColumnIcon },
] as const

export const THEMES: { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
]

const TYPE_ORDER: Account["type"][] = [
  "checking",
  "savings",
  "cash",
  "credit",
  "investment",
]

/** Open accounts, by type then name, as the sidebar and ⌘K list them. */
export function openAccounts(accounts: Account[] | undefined): Account[] {
  return (accounts ?? [])
    .filter((a) => !a.closed)
    .sort(
      (a, b) =>
        TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
        a.name.localeCompare(b.name)
    )
}

/** Whether `pathname` is in the section `to` (Overview only on "/" and /activity). */
export function isActive(to: string, pathname: string): boolean {
  if (to === "/") return pathname === "/" || pathname.startsWith("/activity")
  return pathname === to || pathname.startsWith(`${to}/`)
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const accounts = openAccounts(useQuery(queries.accounts()).data)
  const currency = useQuery(queries.settings()).data?.currency

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="hover:bg-transparent">
              <Link to="/">
                <span
                  aria-hidden
                  className="-ml-0.5 flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-sidebar-primary font-serif text-[13px] leading-none text-sidebar-primary-foreground italic"
                >
                  ƒ
                </span>
                <span className="text-[15px] font-semibold tracking-tight">
                  florin
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu className="gap-0.5">
            {NAV.map((item) => (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  asChild
                  tooltip={item.label}
                  isActive={isActive(item.to, pathname)}
                >
                  <Link to={item.to}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
                {item.to === "/accounts" && accounts.length > 0 && (
                  <SidebarMenuSub className="mr-0 gap-0 pr-0">
                    {accounts.map((a) => (
                      <SidebarMenuSubItem key={a.id}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={pathname === `/accounts/${a.id}`}
                        >
                          <Link
                            to="/accounts/$id"
                            params={{ id: String(a.id) }}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {a.name}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                              {formatMoney(a.balance, a.currency, {
                                symbol: a.currency !== currency,
                              })}
                            </span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu className="gap-0.5">
          <SyncLine />
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Settings"
              isActive={pathname.startsWith("/settings")}
            >
              <Link to="/settings">
                <SettingsIcon />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <ThemeMenu />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/** "Synced 12 min ago", opening the list of connections. Absent with none. */
function SyncLine() {
  const connections = useConnections()
  const summary = syncSummary(connections)
  const { isMobile, state } = useSidebar()
  if (!summary) return null
  return (
    <SidebarMenuItem>
      <Popover>
        <PopoverTrigger asChild>
          <SidebarMenuButton
            tooltip={summary.text}
            className={cn(
              "text-muted-foreground",
              summary.tone === "warning" && "text-warning",
              summary.tone === "negative" && "text-negative"
            )}
          >
            {summary.syncing ? (
              <Spinner />
            ) : summary.tone === "ok" ? (
              <RefreshCwIcon />
            ) : (
              <span className="flex size-4 items-center justify-center">
                <StatusDot tone={summary.tone} />
              </span>
            )}
            <span>{summary.text}</span>
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          side={isMobile || state === "expanded" ? "top" : "right"}
          align="start"
          className="w-80 px-4 py-1"
        >
          <ConnectionList connections={connections} />
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  )
}

function ThemeMenu() {
  const [theme, setTheme] = useTheme()
  const current = THEMES.find((t) => t.value === theme) ?? THEMES[0]
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton tooltip="Theme">
            <current.icon />
            <span>Theme</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-40">
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
    </SidebarMenuItem>
  )
}
