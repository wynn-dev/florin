import { existsSync, readFileSync, statSync } from "node:fs"
import { describe, expect, test, vi } from "vitest"
import { useTempHome } from "./setup"
import { configPath, databasePath, loadConfig } from "@/server/config"
import * as data from "@/server/data"
import {
  deleteSecret,
  getSecret,
  secretInfo,
  setSecret,
} from "@/server/secrets"
import { Route as settingsRoute } from "@/routes/api/settings"

useTempHome()

const KEY =
  "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----"

type Handler = (ctx: { request: Request }) => Promise<Response>
const handlers = settingsRoute.options.server!.handlers as Record<
  string,
  Handler
>
const call = (method: string, body?: unknown) =>
  handlers[method]({
    request: new Request("http://localhost/api/settings", {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  })

describe("secrets", () => {
  test("are kept in the private config, with when they were set", () => {
    vi.useFakeTimers({
      now: new Date("2026-11-12T10:00:00Z"),
      toFake: ["Date"],
    })
    expect(secretInfo("enablebanking.privateKey")).toEqual({
      set: false,
      setAt: null,
    })
    expect(getSecret("enablebanking.privateKey")).toBeUndefined()

    setSecret("enablebanking.privateKey", KEY)
    setSecret("ibkr.token", "123456789012345678901234")
    expect(getSecret("enablebanking.privateKey")).toBe(KEY)
    expect(secretInfo("enablebanking.privateKey")).toEqual({
      set: true,
      setAt: "2026-11-12T10:00:00.000Z",
    })
    expect(statSync(configPath()).mode & 0o777).toBe(0o600)
    // The rest of the config is untouched.
    expect(loadConfig().sessionSecret).toMatch(/^[0-9a-f]{64}$/)

    deleteSecret("ibkr.token")
    expect(getSecret("ibkr.token")).toBeUndefined()
    expect(secretInfo("ibkr.token").set).toBe(false)
    expect(getSecret("enablebanking.privateKey")).toBe(KEY)
    vi.useRealTimers()
  })

  test("never reach the database or the settings API", async () => {
    setSecret("enablebanking.privateKey", KEY)
    const res = await call("GET")
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({
      currency: "EUR",
      publicUrl: "",
      locale: "",
    })
    expect(text).not.toContain("not-a-real-key")

    const patched = await (
      await call("PATCH", { publicUrl: "https://florin.example.com/" })
    ).text()
    expect(patched).not.toContain("not-a-real-key")

    for (const file of [databasePath(), `${databasePath()}-wal`]) {
      if (existsSync(file))
        expect(readFileSync(file).includes("not-a-real-key")).toBe(false)
    }
    expect(readFileSync(configPath(), "utf8")).toContain("not-a-real-key")
  })
})

describe("public address", () => {
  test("defaults to localhost on florin's port and is set through the settings API", async () => {
    await call("PATCH", { publicUrl: "" })
    expect(data.publicUrl()).toBe(`http://localhost:${loadConfig().port}`)

    const res = await call("PATCH", {
      publicUrl: " https://florin.example.com/ ",
    })
    expect(await res.json()).toEqual({
      currency: "EUR",
      publicUrl: "https://florin.example.com",
      locale: "",
    })
    expect(data.publicUrl()).toBe("https://florin.example.com")
    expect(data.listActivity().items[0]).toMatchObject({
      actor: "person",
      summary: "Set the public address to https://florin.example.com",
    })

    for (const bad of [
      "florin.example.com",
      "ftp://x.example",
      "https://x.example/?a=1",
      42,
    ]) {
      expect((await call("PATCH", { publicUrl: bad })).status).toBe(400)
    }
    expect(data.publicUrl()).toBe("https://florin.example.com")
  })
})
