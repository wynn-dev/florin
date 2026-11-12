import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  ArrowLeftRightIcon,
  ChartColumnIcon,
  HouseIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PiggyBankIcon,
  SunIcon,
  WalletIcon,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { api, queries } from "@/lib/api"
import { formatMoney } from "@/lib/format"
import { useTheme } from "@/lib/theme"

const NAV = [
  { to: "/", label: "Overview", icon: HouseIcon },
  { to: "/budget", label: "Budget", icon: PiggyBankIcon },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRightIcon },
  { to: "/accounts", label: "Accounts", icon: WalletIcon },
  { to: "/reports", label: "Reports", icon: ChartColumnIcon },
] as const

const THEME_ICON = { light: SunIcon, dark: MoonIcon, system: MonitorIcon }
const THEME_LABEL = {
  light: "Light theme",
  dark: "Dark theme",
  system: "System theme",
}
const NEXT_THEME = { light: "dark", dark: "system", system: "light" } as const

export function AppSidebar() {
  const accounts = useQuery(queries.accounts())
  const [theme, setTheme] = useTheme()
  const ThemeIcon = THEME_ICON[theme]

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="px-2 py-1.5 text-base font-semibold tracking-tight">
          florin
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV.map((item) => (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton asChild>
                  <Link
                    to={item.to}
                    activeOptions={{ exact: item.to === "/" }}
                    activeProps={{ "data-active": true }}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Accounts</SidebarGroupLabel>
          <SidebarMenu>
            {accounts.data
              ?.filter((a) => !a.closed)
              .map((a) => (
                <SidebarMenuItem key={a.id}>
                  <SidebarMenuButton asChild>
                    <Link to="/transactions" search={{ accountId: a.id }}>
                      <span className="truncate">{a.name}</span>
                    </Link>
                  </SidebarMenuButton>
                  <SidebarMenuBadge className="tabular-nums">
                    {formatMoney(a.balance, a.currency, { compact: true })}
                  </SidebarMenuBadge>
                </SidebarMenuItem>
              ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => setTheme(NEXT_THEME[theme])}>
              <ThemeIcon />
              <span>{THEME_LABEL[theme]}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={async () => {
                await api("/session", { method: "DELETE" })
                window.location.href = "/login"
              }}
            >
              <LogOutIcon />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
