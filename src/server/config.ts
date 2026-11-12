// florin's folder (~/.florin, or FLORIN_HOME) holds florin.db and config.json.
// config.json is private (0600): it holds the password hash, the session
// secret, the one-time setup code until a password is set, and later the
// connectors' credentials.
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
  /** scrypt hash of the dashboard password; absent until it is first set. */
  passwordHash?: string
  /**
   * While no password is set: the code the first-run page asks for, so only
   * someone who can read florin's output or folder can claim the dashboard.
   */
  setupCode?: string
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

/**
 * Reads config.json, creating the folder and a fresh config on first run, and
 * a setup code whenever no password is set yet.
 */
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
  const config = JSON.parse(readFileSync(path, "utf8")) as Config
  if (!config.passwordHash && !config.setupCode) {
    config.setupCode = newSetupCode()
    saveConfig(config)
  }
  return config
}

/** "7KQ2-M9XD-4TFH": twelve characters, easy to read and type. */
function newSetupCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const chars = [...randomBytes(12)].map((b) => alphabet[b % alphabet.length])
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join("")).join("-")
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
