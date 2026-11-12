// florin's folder (~/.florin, or FLORIN_HOME) holds florin.db and config.json.
// config.json is private (0600): it holds the password hash and session secret,
// and later the connectors' credentials.
import { randomBytes } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type Config = {
  host: string
  port: number
  /** scrypt hash of the dashboard password; absent until the first sign-in sets it. */
  passwordHash?: string
  sessionSecret: string
}

export const DEFAULT_PORT = 4680

export function homeDir(): string {
  return process.env.FLORIN_HOME || join(homedir(), ".florin")
}

export function configPath(): string {
  return join(homeDir(), "config.json")
}

export function databasePath(): string {
  return join(homeDir(), "florin.db")
}

/** Reads config.json, creating the folder and a fresh config on first run. */
export function loadConfig(): Config {
  const path = configPath()
  if (!existsSync(path)) {
    mkdirSync(homeDir(), { recursive: true, mode: 0o700 })
    saveConfig({
      host: "127.0.0.1",
      port: DEFAULT_PORT,
      sessionSecret: randomBytes(32).toString("hex"),
    })
  }
  return JSON.parse(readFileSync(path, "utf8")) as Config
}

export function saveConfig(config: Config): void {
  const path = configPath()
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 })
  chmodSync(path, 0o600)
}

/** The port florin listens on: FLORIN_PORT, else config.json. */
export function listenPort(config: Config): number {
  return Number(process.env.FLORIN_PORT) || config.port
}
