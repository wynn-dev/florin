// Slot for the Enable Banking connector's settings. The connector ships
// <EnableBankingSettings /> in src/components/connections/enable-banking/;
// when that folder exists it is mounted here, otherwise a plain line shows.
import type { ComponentType } from "react"
import { Aside, SettingsRow } from "@/components/settings/row"

const modules = import.meta.glob<Record<string, unknown>>(
  "../connections/enable-banking/*.tsx",
  { eager: true }
)
const EnableBankingSettings = Object.values(modules)
  .map((m) => m.EnableBankingSettings)
  .find(Boolean) as ComponentType | undefined

export function EnableBankingSlot() {
  if (EnableBankingSettings) return <EnableBankingSettings />
  return (
    <SettingsRow title="Bank sync">
      <Aside>Not in this version of florin</Aside>
    </SettingsRow>
  )
}

/** The connector's Connect a bank dialog, when it is part of this build. */
export const ConnectBankDialog = Object.values(modules)
  .map((m) => m.ConnectBankDialog)
  .find(Boolean) as
  | ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void }>
  | undefined
