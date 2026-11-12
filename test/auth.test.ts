import { statSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import {
  checkSetupCode,
  createSession,
  needsSetup,
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
