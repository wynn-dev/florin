// The `florin` command. Built to .output/cli.mjs next to the server build
// (.output/server/index.mjs), which `florin start` runs in this same process.
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  configPath,
  databasePath,
  homeDir,
  listenPort,
  loadConfig,
} from "./server/config"
import { closeDatabase, db } from "./server/db"
import { seedDemo } from "./server/seed"
import pkg from "../package.json"

const HELP = `florin ${pkg.version}: a budget dashboard and MCP server on one port

Usage: florin <command>

  start                 Run florin in the foreground
  status                Show where florin keeps its data and whether it is running
  version               Print the version
  seed-demo             Fill an empty florin with sample data
  service <action>      Manage the background service: install, uninstall, start, stop, status
  mcp                   Serve the MCP over stdio

Data lives in ${homeDir()} (set FLORIN_HOME to move it). FLORIN_PORT overrides the port.`

const commands: Record<string, (args: string[]) => Promise<void> | void> = {
  start,
  status,
  version: () => console.log(pkg.version),
  "seed-demo": seed,
  service: (args) => notYet(`service ${args[0] ?? ""}`.trim()),
  mcp: () => notYet("mcp"),
  help: () => console.log(HELP),
}

async function start() {
  const config = loadConfig()
  db() // create or migrate the database before serving
  closeDatabase()
  const port = listenPort(config)
  const server = fileURLToPath(new URL("./server/index.mjs", import.meta.url))
  if (!existsSync(server))
    throw new Error(`no server build at ${server}; run pnpm build`)
  process.env.NITRO_HOST = config.host
  process.env.NITRO_PORT = String(port)
  console.log(
    `florin ${pkg.version} on http://${config.host}:${port} (data in ${homeDir()})`
  )
  if (!config.passwordHash)
    console.log("First run: open the dashboard to choose a password.")
  await import(server)
}

async function status() {
  const config = loadConfig()
  const url = `http://${config.host}:${listenPort(config)}`
  let running = false
  try {
    running = (
      await fetch(`${url}/api/session`, { signal: AbortSignal.timeout(2000) })
    ).ok
  } catch {
    // not listening
  }
  console.log(`florin ${pkg.version}`)
  console.log(
    `  ${running ? "running at" : "not running; would listen on"} ${url}`
  )
  console.log(`  data      ${databasePath()}`)
  console.log(`  config    ${configPath()}`)
}

function seed() {
  const result = seedDemo()
  closeDatabase()
  console.log(
    `Added ${result.accounts} accounts and ${result.transactions} transactions over ${result.months} months.`
  )
}

function notYet(command: string) {
  console.error(`florin ${command}: not implemented yet`)
  process.exitCode = 2
}

const [name = "help", ...args] = process.argv.slice(2)
const command =
  commands[
    name === "--help" || name === "-h"
      ? "help"
      : name === "--version"
        ? "version"
        : name
  ]
if (!command) {
  console.error(`florin: unknown command "${name}"\n\n${HELP}`)
  process.exit(2)
}
try {
  await command(args)
} catch (error) {
  console.error(`florin ${name}: ${(error as Error).message}`)
  process.exit(1)
}
