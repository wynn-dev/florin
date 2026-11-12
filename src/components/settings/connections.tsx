import { EnableBankingSlot } from "@/components/settings/enable-banking-slot"
import { IbkrSlot } from "@/components/settings/ibkr-slot"
import { McpSettings } from "@/components/settings/mcp"
import { SettingsSection } from "@/components/settings/row"

export function ConnectionsSettings() {
  return (
    <div className="flex flex-col gap-10">
      <SettingsSection id="enable-banking" title="Enable Banking">
        <EnableBankingSlot />
      </SettingsSection>
      <SettingsSection id="ibkr" title="Interactive Brokers">
        <IbkrSlot />
      </SettingsSection>
      <McpSettings />
    </div>
  )
}
