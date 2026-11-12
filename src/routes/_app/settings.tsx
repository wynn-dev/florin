import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { Page } from "@/components/page"
import { ConnectionsSettings } from "@/components/settings/connections"
import { GeneralSettings } from "@/components/settings/general"
import { PayeesSettings } from "@/components/settings/payees"
import { RulesSettings } from "@/components/settings/rules"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

const SECTIONS = [
  { value: "general", label: "General" },
  { value: "connections", label: "Connections" },
  { value: "payees", label: "Payees" },
  { value: "rules", label: "Rules" },
] as const

type Section = (typeof SECTIONS)[number]["value"]

/** /settings?section=general|connections|payees|rules */
export const Route = createFileRoute("/_app/settings")({
  validateSearch: (search: Record<string, unknown>): { section?: Section } =>
    SECTIONS.some((s) => s.value === search.section)
      ? { section: search.section as Section }
      : {},
  component: SettingsPage,
})

function SettingsPage() {
  const { section = "general" } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <Page title="Settings">
      <Tabs
        value={section}
        onValueChange={(v) =>
          void navigate({ search: { section: v as Section }, replace: true })
        }
        className="md:hidden"
      >
        <TabsList className="w-full">
          {SECTIONS.map((s) => (
            <TabsTrigger key={s.value} value={s.value}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex gap-10">
        <nav className="hidden w-40 shrink-0 flex-col gap-0.5 md:flex">
          {SECTIONS.map((s) => (
            <Link
              key={s.value}
              to="/settings"
              search={{ section: s.value }}
              replace
              className={cn(
                "flex h-8 items-center rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                section === s.value && "bg-muted font-medium text-foreground"
              )}
            >
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="max-w-2xl min-w-0 flex-1">
          {section === "general" && <GeneralSettings />}
          {section === "connections" && <ConnectionsSettings />}
          {section === "payees" && <PayeesSettings />}
          {section === "rules" && <RulesSettings />}
        </div>
      </div>
    </Page>
  )
}
