// Slot for the Interactive Brokers connector's settings. The connector ships
// <IbkrSettings /> in src/components/connections/ibkr/; when that folder
// exists it is mounted here, otherwise a plain line shows.
import type { ComponentType } from "react"
import { Aside, SettingsRow } from "@/components/settings/row"

const modules = import.meta.glob<Record<string, unknown>>(
  "../connections/ibkr/*.tsx",
  { eager: true }
)
const IbkrSettings = Object.values(modules)
  .map((m) => m.IbkrSettings)
  .find(Boolean) as ComponentType | undefined

export function IbkrSlot() {
  if (IbkrSettings) return <IbkrSettings />
  return (
    <SettingsRow title="Flex reports">
      <Aside>Not in this version of florin</Aside>
    </SettingsRow>
  )
}

/** The connector's Connect Interactive Brokers dialog, when it is part of this build. */
export const ConnectIbkrDialog = Object.values(modules)
  .map((m) => m.ConnectIbkrDialog)
  .find(Boolean) as
  | ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void }>
  | undefined
