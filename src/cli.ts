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
import { setPassword } from "./server/auth"
import { closeDatabase, db } from "./server/db"
import { seedDemo } from "./server/seed"
import pkg from "../package.json"

const HELP = `florin ${pkg.version}: a budget dashboard and MCP server on one port

Usage: florin <command>

  start                 Run florin in the foreground
  status                Show where florin keeps its data and whether it is running
  version               Print the version
  seed-demo             Fill an empty florin with sample data
  password              Set or reset the dashboard password
  setup-code            Print the code the first-run page asks for
  token <name>          Create an MCP access token; prints only the token
  service <action>      Manage the background service: install, uninstall, start, stop, status

Data lives in ${homeDir()} (set FLORIN_HOME to move it). FLORIN_PORT overrides the port.`

const commands: Record<string, (args: string[]) => Promise<void> | void> = {
  start,
  status,
  version: () => console.log(pkg.version),
  "seed-demo": seed,
  password,
  "setup-code": setupCode,
  token: async (args) => (await import("./cli/token")).token(args),
  service: async (args) => (await import("./cli/service")).service(args),
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
  if (config.setupCode) {
    console.log(
      `First run: open the dashboard and enter setup code ${config.setupCode} to choose a password.`
    )
  }
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
  if (config.setupCode)
    console.log(`  setup code ${config.setupCode} (no password set yet)`)
}

function setupCode() {
  const config = loadConfig()
  if (!config.setupCode) {
    console.log(
      "The password is already set; use florin password to change it."
    )
    return
  }
  console.log(config.setupCode)
}

/** Sets the dashboard password: typed twice at a terminal, or one line on stdin. */
async function password() {
  let value: string
  if (process.stdin.isTTY) {
    value = await readHidden("New password: ")
    if ((await readHidden("Again: ")) !== value)
      throw new Error("the passwords differ")
  } else {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
    value = Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0]
  }
  setPassword(value)
  console.log(
    "Password set. Sessions signed in with the old password are signed out."
  )
}

/** Reads a line from the terminal without echoing it. */
function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin
  process.stdout.write(prompt)
  stdin.setRawMode(true)
  stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ""
    const onData = (data: Buffer) => {
      for (const ch of data.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          done()
          return resolve(value)
        }
        if (ch === "\u0003") {
          done()
          return reject(new Error("cancelled"))
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1)
        else value += ch
      }
    }
    const done = () => {
      stdin.off("data", onData)
      stdin.setRawMode(false)
      stdin.pause()
      process.stdout.write("\n")
    }
    stdin.on("data", onData)
  })
}

function seed() {
  const result = seedDemo()
  closeDatabase()
  console.log(
    `Added ${result.accounts} accounts and ${result.transactions} transactions over ${result.months} months.`
  )
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
