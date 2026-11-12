// `florin service install|uninstall|start|stop|status`: runs florin in the
// background as a systemd user unit on Linux or a launchd agent on macOS.
// The unit runs the installed launcher (~/.local/share/florin/current/bin/florin)
// with `start`, so an update by install.sh only needs a restart. FLORIN_HOME
// and FLORIN_PORT, when set at install, are written into the unit.
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir, userInfo } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { homeDir, listenPort, loadConfig } from "../server/config"

/** The environment variables a unit carries over from `service install`. */
const CARRIED_ENV = ["FLORIN_HOME", "FLORIN_PORT"] as const

export type UnitSpec = {
  /** The command and its arguments, `start` included. */
  command: string[]
  env: Record<string, string>
}

/** The unit's name: florin, or FLORIN_SERVICE_NAME (meant for tests only). */
function serviceName(): string {
  return process.env.FLORIN_SERVICE_NAME || "florin"
}

export function launchdLabel(name = serviceName()): string {
  return `io.github.wynn-dev.${name}`
}

// ---------------------------------------------------------------------------
// Unit text

/** Quotes a word for a systemd unit line: "…" with \ " escaped and % doubled. */
function systemdQuote(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&").replace(/%/g, "%%")}"`
}

export function systemdUnit(spec: UnitSpec): string {
  const env = Object.entries(spec.env).map(
    ([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}\n`
  )
  return `[Unit]
Description=florin, a budget dashboard and MCP server
Documentation=https://github.com/wynn-dev/florin

[Service]
Type=simple
ExecStart=${spec.command.map(systemdQuote).join(" ")}
${env.join("")}Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function launchdPlist(
  spec: UnitSpec & { label: string; logFile: string }
): string {
  const string = (value: string) => `<string>${xmlEscape(value)}</string>`
  const env = Object.entries(spec.env)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${string(spec.label)}
  <key>ProgramArguments</key>
  <array>
${spec.command.map((arg) => `    ${string(arg)}\n`).join("")}  </array>
${
  env.length
    ? `  <key>EnvironmentVariables</key>
  <dict>
${env.map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    ${string(value)}\n`).join("")}  </dict>
`
    : ""
}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  ${string(spec.logFile)}
  <key>StandardErrorPath</key>
  ${string(spec.logFile)}
</dict>
</plist>
`
}

/** Reads back the FLORIN_* variables a unit or plist written by florin carries. */
export function unitEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const match of text.matchAll(/^Environment="(FLORIN_\w+)=(.*)"$/gm)) {
    env[match[1]] = match[2].replace(/%%/g, "%").replace(/\\(.)/g, "$1")
  }
  for (const match of text.matchAll(
    /<key>(FLORIN_\w+)<\/key>\s*<string>(.*?)<\/string>/g
  )) {
    env[match[1]] = match[2]
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&")
  }
  return env
}

// ---------------------------------------------------------------------------
// What the unit runs

/**
 * The command the unit runs: the launcher from a release (through its
 * `current` link when install.sh put it there, so updates carry over), or,
 * from a development build, this Node on this cli.mjs.
 */
function serviceCommand(): string[] {
  const cli = realpathSync(process.argv[1])
  const root = dirname(dirname(cli))
  const launcher = join(root, "bin", "florin")
  if (basename(dirname(cli)) === "app" && existsSync(launcher)) {
    const current = join(dirname(root), "current")
    try {
      if (realpathSync(current) === root)
        return [join(current, "bin", "florin"), "start"]
    } catch {
      // no current link: a tarball unpacked by hand
    }
    return [launcher, "start"]
  }
  return [process.execPath, cli, "start"]
}

function carriedEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of CARRIED_ENV) {
    const value = process.env[key]
    if (value) env[key] = key === "FLORIN_HOME" ? resolve(value) : value
  }
  return env
}

// ---------------------------------------------------------------------------
// Shared helpers

type Run = { ok: boolean; missing: boolean; stdout: string; stderr: string }

function run(command: string, args: string[]): Run {
  const result = spawnSync(command, args, { encoding: "utf8" })
  return {
    ok: result.status === 0,
    missing: (result.error as { code?: string } | undefined)?.code === "ENOENT",
    stdout: result.stdout ?? "",
    stderr: (result.stderr ?? "").trim(),
  }
}

/** Runs a command that must succeed, failing with its own error output. */
function must(command: string, args: string[]): string {
  const result = run(command, args)
  if (!result.ok)
    throw new Error(
      `${command} ${args.join(" ")} failed${result.stderr ? `: ${result.stderr}` : ""}`
    )
  return result.stdout
}

/** Shows a path under the home folder as ~/…, as people type it. */
function tilde(path: string): string {
  const home = homedir()
  return path.startsWith(home + "/") ? `~${path.slice(home.length)}` : path
}

/** Uses the FLORIN_* variables the installed unit carries, so this command sees what the service sees. */
function adoptUnitEnv(path: string) {
  if (!existsSync(path)) return
  Object.assign(process.env, unitEnv(readFileSync(path, "utf8")))
}

function address(): string {
  const config = loadConfig()
  const host = config.host === "0.0.0.0" ? "127.0.0.1" : config.host
  return `http://${host}:${listenPort(config)}`
}

async function answers(url: string): Promise<boolean> {
  try {
    return (
      await fetch(`${url}/api/session`, { signal: AbortSignal.timeout(1000) })
    ).ok
  } catch {
    return false
  }
}

async function waitUntilAnswering(url: string, seconds = 20): Promise<boolean> {
  for (let i = 0; i < seconds * 4; i++) {
    if (await answers(url)) return true
    await new Promise((done) => setTimeout(done, 250))
  }
  return false
}

const FOREGROUND =
  "florin start still runs florin in the foreground, under any process supervisor you like."

class Unavailable extends Error {}

// ---------------------------------------------------------------------------
// Platforms

type Status = {
  installed: boolean
  running: boolean
  /** A line about a stopped service: failed, restarting, or plainly stopped. */
  state: string
  since?: string
  pid?: string
}

type Platform = {
  kind: string
  unitPath: string
  logs: string
  check: () => void
  install: () => void
  uninstall: () => void
  start: () => void
  stop: () => void
  status: () => Status
  /** What install says about when the service starts. */
  startsWhen: () => string
}

function systemd(): Platform {
  const unit = `${serviceName()}.service`
  const unitPath = join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "systemd",
    "user",
    unit
  )
  const systemctl = (...args: string[]) =>
    must("systemctl", ["--user", ...args])
  let lingerNote = ""
  return {
    kind: `systemd user unit ${unit}`,
    unitPath,
    logs: `journalctl --user -u ${serviceName()}`,
    check() {
      const result = run("systemctl", ["--user", "show-environment"])
      if (result.missing)
        throw new Unavailable(
          `This system has no systemctl, so florin can't run as a systemd service here. ${FOREGROUND}`
        )
      if (!result.ok)
        throw new Unavailable(
          `systemd's user manager isn't reachable (${result.stderr.split("\n")[0].replace(/ \(consider .*$/, "") || "systemctl --user failed"}). ` +
            `That happens in containers, after su or sudo, and without a login session; log in as ${userInfo().username} directly (console or ssh) and try again. ${FOREGROUND}`
        )
    },
    install() {
      writeFileSync(
        unitPath,
        systemdUnit({ command: serviceCommand(), env: carriedEnv() })
      )
      systemctl("daemon-reload")
      systemctl("enable", unit)
      systemctl("restart", unit)
      lingerNote = enableLinger()
    },
    uninstall() {
      run("systemctl", ["--user", "disable", "--now", unit])
      rmSync(unitPath, { force: true })
      systemctl("daemon-reload")
      run("systemctl", ["--user", "reset-failed", unit])
    },
    start: () => systemctl("start", unit),
    stop: () => systemctl("stop", unit),
    status() {
      const props = Object.fromEntries(
        systemctl(
          "show",
          unit,
          "-p",
          "ActiveState,SubState,MainPID,ActiveEnterTimestamp,Result"
        )
          .split("\n")
          .filter(Boolean)
          .map((line) => [
            line.slice(0, line.indexOf("=")),
            line.slice(line.indexOf("=") + 1),
          ])
      )
      const running = props.ActiveState === "active"
      const state =
        props.SubState === "auto-restart"
          ? "restarting after a failure"
          : props.ActiveState === "failed"
            ? `failed (${props.Result})`
            : "stopped"
      return {
        installed: existsSync(unitPath),
        running,
        state,
        since: running ? props.ActiveEnterTimestamp : undefined,
        pid: running ? props.MainPID : undefined,
      }
    },
    startsWhen: () =>
      lingerNote ||
      "It starts when the machine boots, and restarts if it fails.",
  }
}

/**
 * Lets the user's services run without a login session, so florin starts at
 * boot. Returns what to tell the person when that isn't on.
 */
function enableLinger(): string {
  const user = userInfo().username
  const linger = run("loginctl", ["show-user", user, "-p", "Linger", "--value"])
  if (linger.ok && linger.stdout.trim() === "yes") return ""
  if (run("loginctl", ["enable-linger", user]).ok) return ""
  return (
    "It starts when you log in, and restarts if it fails. To keep it running while you are logged out and start it at boot, run:\n" +
    `  sudo loginctl enable-linger ${user}`
  )
}

/** Blocks for `ms` milliseconds: the CLI waits on launchd between commands. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** launchd keeps its log file forever; past this size a start moves it to florin.log.1. */
export const LOG_LIMIT_BYTES = 5 * 1024 * 1024

/** Keeps one old log and starts a new one once the log passes LOG_LIMIT_BYTES. */
export function rotateLog(file: string, limit = LOG_LIMIT_BYTES): boolean {
  try {
    if (statSync(file).size < limit) return false
  } catch {
    return false
  }
  renameSync(file, `${file}.1`)
  return true
}

function launchd(): Platform {
  const label = launchdLabel()
  const domain = `gui/${process.getuid?.() ?? userInfo().uid}`
  const target = `${domain}/${label}`
  const unitPath = join(homedir(), "Library", "LaunchAgents", `${label}.plist`)
  const logFile = () => join(homeDir(), "logs", "florin.log")
  const loaded = () => run("launchctl", ["print", target]).ok
  // bootout returns before the job is gone; bootstrapping it again too soon
  // fails with "Bootstrap failed: 5: Input/output error". So wait for it to
  // go, and retry a bootstrap that still lands in that window.
  const bootout = () => {
    run("launchctl", ["bootout", target])
    for (let i = 0; i < 50 && loaded(); i++) pause(200)
  }
  const bootstrap = () => {
    rotateLog(logFile())
    run("launchctl", ["enable", target])
    for (let attempt = 1; ; attempt++) {
      const result = run("launchctl", ["bootstrap", domain, unitPath])
      if (result.ok || loaded()) return
      if (attempt === 5)
        throw new Error(
          `launchctl bootstrap ${domain} ${unitPath} failed${result.stderr ? `: ${result.stderr}` : ""}`
        )
      pause(attempt * 500)
    }
  }
  return {
    kind: `launchd agent ${label}`,
    unitPath,
    get logs() {
      return tilde(logFile())
    },
    check() {
      const result = run("launchctl", ["print", domain])
      if (result.missing)
        throw new Unavailable(
          `This Mac has no launchctl on the PATH, so florin can't install its launchd agent. ${FOREGROUND}`
        )
      if (!result.ok)
        throw new Unavailable(
          `launchd has no session for you (${domain}). That happens over ssh when you aren't also logged in at the Mac; log in at the Mac, then run this again. ${FOREGROUND}`
        )
    },
    install() {
      mkdirSync(dirname(logFile()), { recursive: true })
      mkdirSync(dirname(unitPath), { recursive: true })
      if (loaded()) bootout()
      writeFileSync(
        unitPath,
        launchdPlist({
          label,
          command: serviceCommand(),
          env: carriedEnv(),
          logFile: logFile(),
        })
      )
      bootstrap()
    },
    uninstall() {
      if (loaded()) bootout()
      rmSync(unitPath, { force: true })
    },
    start() {
      if (loaded()) must("launchctl", ["kickstart", target])
      else bootstrap()
    },
    stop() {
      if (loaded()) bootout()
    },
    status() {
      const printed = run("launchctl", ["print", target])
      const pid = /^\s*pid = (\d+)$/m.exec(printed.stdout)?.[1]
      const running = /^\s*state = running$/m.test(printed.stdout) && !!pid
      const lastExit = /^\s*last exit code = (.+)$/m.exec(printed.stdout)?.[1]
      return {
        installed: existsSync(unitPath),
        running,
        state: !printed.ok
          ? "stopped"
          : lastExit && lastExit !== "0" && !lastExit.startsWith("(never")
            ? `not running; it last exited with ${lastExit}`
            : "loaded but not running",
        since: pid
          ? run("ps", ["-o", "lstart=", "-p", pid]).stdout.trim()
          : undefined,
        pid,
      }
    },
    startsWhen: () => "It starts when you log in, and restarts if it stops.",
  }
}

function platform(): Platform {
  if (process.platform === "linux") return systemd()
  if (process.platform === "darwin") return launchd()
  throw new Unavailable(
    `florin service runs florin as a systemd service on Linux or a launchd agent on macOS, not on ${process.platform}. ${FOREGROUND}`
  )
}

// ---------------------------------------------------------------------------
// Commands

const HELP = `Usage: florin service <action>

  install     Run florin in the background, now and whenever the machine starts
  uninstall   Stop it and remove the service (florin's data stays)
  start       Start the installed service
  stop        Stop it until the next start, login or boot
  status      Show whether it runs, since when, where, and where its logs are`

export async function service(args: string[]): Promise<void> {
  const action = args[0]
  const actions: Record<string, (p: Platform) => Promise<void> | void> = {
    install,
    uninstall,
    start,
    stop,
    status,
  }
  if (!action || action === "help" || action === "--help") {
    console.log(HELP)
    return
  }
  if (!(action in actions)) {
    console.error(`florin service: unknown action "${action}"\n\n${HELP}`)
    process.exitCode = 2
    return
  }
  try {
    const p = platform()
    p.check()
    await actions[action](p)
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error
    console.error(error.message)
    process.exitCode = 1
  }
}

async function install(p: Platform) {
  const wasRunning = existsSync(p.unitPath) && p.status().running
  const url = address() // also creates florin's folder and config before the service reads them
  if (!wasRunning && (await answers(url)))
    throw new Error(
      `something already answers at ${url}, perhaps florin start in another terminal; stop it and run this again`
    )
  mkdirSync(dirname(p.unitPath), { recursive: true })
  p.install()
  console.log(`Installed florin as a ${p.kind}: ${tilde(p.unitPath)}`)
  console.log(`${p.startsWhen()} Its data is in ${tilde(homeDir())}.`)
  await reportStarted(p, url)
}

async function uninstall(p: Platform) {
  const data = tilde(homeDir())
  if (!existsSync(p.unitPath)) {
    console.log(
      `florin's service isn't installed, so there is nothing to remove. Your data in ${data} is untouched.`
    )
    return
  }
  adoptUnitEnv(p.unitPath)
  p.uninstall()
  console.log(`Stopped florin and removed its service (${tilde(p.unitPath)}).`)
  console.log(
    `Your data in ${tilde(homeDir())} is untouched; florin service install brings the service back.`
  )
}

async function start(p: Platform) {
  requireInstalled(p)
  adoptUnitEnv(p.unitPath)
  const url = address()
  if (!p.status().running && (await answers(url)))
    throw new Error(
      `something already answers at ${url}, perhaps florin start in another terminal; stop it and run this again`
    )
  p.start()
  await reportStarted(p, url)
}

async function stop(p: Platform) {
  requireInstalled(p)
  p.stop()
  console.log(
    "Stopped florin. It starts again on florin service start, or at the next login or boot."
  )
}

async function status(p: Platform) {
  if (!existsSync(p.unitPath)) {
    console.log(
      "florin's service isn't installed. florin service install runs florin in the background."
    )
    return
  }
  adoptUnitEnv(p.unitPath)
  const s = p.status()
  const url = address()
  console.log(`florin service (${p.kind})`)
  console.log(`  unit      ${tilde(p.unitPath)}`)
  if (s.running) {
    console.log(
      `  running   since ${s.since || "an unknown time"}${s.pid ? `, pid ${s.pid}` : ""}`
    )
    console.log(
      `  address   ${url}${(await answers(url)) ? "" : " (not answering yet)"}`
    )
  } else {
    console.log(`  state     ${s.state}`)
    console.log(`  address   ${url} when running`)
  }
  console.log(`  logs      ${p.logs}`)
  console.log(`  data      ${tilde(homeDir())}`)
}

function requireInstalled(p: Platform) {
  if (!existsSync(p.unitPath))
    throw new Unavailable(
      "florin's service isn't installed; florin service install sets it up and starts it."
    )
}

async function reportStarted(p: Platform, url: string) {
  if (!(await waitUntilAnswering(url))) {
    console.log(
      `florin's service started but isn't answering at ${url} yet. Its logs: ${p.logs}`
    )
    process.exitCode = 1
    return
  }
  console.log(`florin is running at ${url}`)
  const config = loadConfig()
  if (config.setupCode)
    console.log(
      `First run: open it and enter setup code ${config.setupCode} to choose a password.`
    )
}
