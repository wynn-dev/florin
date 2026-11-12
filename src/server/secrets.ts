// Connector credentials (the Enable Banking app id and private key, the IBKR
// Flex token): kept in florin's private config.json (0600), never in the
// database. Only getSecret returns a value, for the connector that uses it;
// the API and logs see secretInfo, which says whether one is set and when.
import { loadConfig, saveConfig } from "./config"

export type SecretInfo = {
  set: boolean
  /** ISO timestamp, UTC; null when not set. */
  setAt: string | null
}

export function setSecret(key: string, value: string): void {
  if (!key) throw new Error("a secret needs a key")
  const config = loadConfig()
  config.secrets = {
    ...config.secrets,
    [key]: { value, setAt: new Date().toISOString() },
  }
  saveConfig(config)
}

export function getSecret(key: string): string | undefined {
  return loadConfig().secrets?.[key]?.value
}

export function secretInfo(key: string): SecretInfo {
  const setAt = loadConfig().secrets?.[key]?.setAt
  return { set: setAt !== undefined, setAt: setAt ?? null }
}

export function deleteSecret(key: string): void {
  const config = loadConfig()
  if (!config.secrets?.[key]) return
  delete config.secrets[key]
  saveConfig(config)
}
