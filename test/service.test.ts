import { describe, expect, test } from "vitest"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  launchdLabel,
  launchdPlist,
  rotateLog,
  systemdUnit,
  unitEnv,
} from "@/cli/service"

const launcher = "/home/ana/.local/share/florin/current/bin/florin"

describe("systemd unit", () => {
  test("runs the launcher, restarts on failure and starts with the user's services", () => {
    expect(systemdUnit({ command: [launcher, "start"], env: {} })).toBe(`[Unit]
Description=florin, a budget dashboard and MCP server
Documentation=https://github.com/wynn-dev/florin

[Service]
Type=simple
ExecStart="${launcher}" "start"
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`)
  })

  test("quotes paths and carries florin's variables", () => {
    const unit = systemdUnit({
      command: ["/opt/my apps/node", '/opt/a"b\\c/cli.mjs', "start"],
      env: { FLORIN_HOME: "/data/100% florin", FLORIN_PORT: "4691" },
    })
    expect(unit).toContain(
      'ExecStart="/opt/my apps/node" "/opt/a\\"b\\\\c/cli.mjs" "start"\n'
    )
    expect(unit).toContain('Environment="FLORIN_HOME=/data/100%% florin"\n')
    expect(unit).toContain('Environment="FLORIN_PORT=4691"\nRestart=')
    expect(unitEnv(unit)).toEqual({
      FLORIN_HOME: "/data/100% florin",
      FLORIN_PORT: "4691",
    })
  })
})

describe("launchd plist", () => {
  const label = launchdLabel("florin")

  test("keeps florin alive, starts at login and logs under florin's folder", () => {
    expect(
      launchdPlist({
        label,
        command: [launcher, "start"],
        env: {},
        logFile: "/Users/ana/.florin/logs/florin.log",
      })
    ).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.github.wynn-dev.florin</string>
  <key>ProgramArguments</key>
  <array>
    <string>${launcher}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/ana/.florin/logs/florin.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/ana/.florin/logs/florin.log</string>
</dict>
</plist>
`)
  })

  test("escapes XML and carries florin's variables", () => {
    const plist = launchdPlist({
      label,
      command: ["/Users/ana/R&D <x>/florin", "start"],
      env: { FLORIN_HOME: "/Users/ana/R&D", FLORIN_PORT: "4691" },
      logFile: "/Users/ana/R&D/logs/florin.log",
    })
    expect(plist).toContain(
      "<string>/Users/ana/R&amp;D &lt;x&gt;/florin</string>"
    )
    expect(plist).toContain(`  <key>EnvironmentVariables</key>
  <dict>
    <key>FLORIN_HOME</key>
    <string>/Users/ana/R&amp;D</string>
    <key>FLORIN_PORT</key>
    <string>4691</string>
  </dict>
  <key>RunAtLoad</key>`)
    expect(unitEnv(plist)).toEqual({
      FLORIN_HOME: "/Users/ana/R&D",
      FLORIN_PORT: "4691",
    })
  })
})

describe("the macOS log", () => {
  test("is moved aside once it passes the limit, keeping one old log", () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "florin-log-"))
    const file = join(dir, "florin.log")
    expect(rotateLog(file, 10)).toBe(false)
    writeFileSync(file, "short")
    expect(rotateLog(file, 10)).toBe(false)
    writeFileSync(file, "a long first log")
    expect(rotateLog(file, 10)).toBe(true)
    expect(existsSync(file)).toBe(false)
    writeFileSync(file, "a long second log")
    expect(rotateLog(file, 10)).toBe(true)
    expect(readFileSync(`${file}.1`, "utf8")).toBe("a long second log")
  })
})
