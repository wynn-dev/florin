import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { useLocation } from "@tanstack/react-router"
import { ebQueries } from "@/components/connections/enable-banking/api"
import { EnableBankingSettings } from "@/components/connections/enable-banking/settings"
import { IbkrSettings } from "@/components/connections/ibkr/ibkr-settings"
import { ibkrStatusQuery } from "@/components/connections/ibkr/use-ibkr"
import { McpSettings } from "@/components/settings/mcp"
import { SettingsSection } from "@/components/settings/row"

export function ConnectionsSettings() {
  // A link to one connection (#ibkr, #enable-banking, #mcp) scrolls to it
  // once the sections above it have loaded and stopped growing.
  const hash = useLocation({ select: (l) => l.hash })
  const bank = useQuery(ebQueries.status())
  const ibkr = useQuery(ibkrStatusQuery())
  const loaded = !bank.isPending && !ibkr.isPending
  useEffect(() => {
    if (!hash || !loaded) return
    document.getElementById(hash)?.scrollIntoView({ block: "start" })
  }, [hash, loaded])

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection id="enable-banking" title="Enable Banking">
        <EnableBankingSettings />
      </SettingsSection>
      <SettingsSection id="ibkr" title="Interactive Brokers">
        <IbkrSettings />
      </SettingsSection>
      <McpSettings />
    </div>
  )
}
