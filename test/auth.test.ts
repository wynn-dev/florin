import { readdirSync, statSync } from "node:fs"
import { dirname } from "node:path"
import { describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import {
  checkSetupCode,
  createSession,
  needsSetup,
  revokeSession,
  setPassword,
  verifySession,
} from "@/server/auth"
import { configPath, loadConfig } from "@/server/config"

useTempHome()

describe("first run", () => {
  test("a setup code exists until the password is set, in a private config", () => {
    const code = loadConfig().setupCode
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(loadConfig().setupCode).toBe(code)
    expect(statSync(configPath()).mode & 0o777).toBe(0o600)
    expect(needsSetup()).toBe(true)

    expect(checkSetupCode(undefined)).toBe(false)
    expect(checkSetupCode("AAAA-BBBB-CCCC")).toBe(false)
    expect(checkSetupCode(code!.toLowerCase())).toBe(true)

    setPassword("correct horse")
    expect(loadConfig().setupCode).toBeUndefined()
    expect(checkSetupCode(code)).toBe(false)
    expect(needsSetup()).toBe(false)
  })

  test("changing the password signs existing sessions out", () => {
    const token = createSession()
    expect(verifySession(token)).toBe(true)
    setPassword("another password")
    expect(verifySession(token)).toBe(false)
    expect(loadConfig().setupCode).toBeUndefined()
  })
})

describe("signing out", () => {
  test("revokes that session's token, not only its cookie; others stay signed in", () => {
    const mine = createSession()
    const other = createSession()
    revokeSession(mine)
    expect(verifySession(mine)).toBe(false)
    expect(verifySession(other)).toBe(true)
    // config.json is replaced whole, private, with no temp file left behind.
    expect(statSync(configPath()).mode & 0o777).toBe(0o600)
    expect(
      readdirSync(dirname(configPath())).filter((f) => f.endsWith(".tmp"))
    ).toEqual([])
  })
})
