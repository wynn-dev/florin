// `florin token <name>`: the token alone on stdout, the same store and
// Activity line as a token made in Settings.
import { describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"
import { token } from "@/cli/token"

useTempHome()

function capture() {
  const text: string[] = []
  return { write: (t: string) => text.push(t), text: () => text.join("") }
}

describe("florin token", () => {
  test("prints only the token, which works and shows in Settings and Activity", () => {
    const out = capture()
    const err = capture()
    token(["Assistant"], out, err)
    const value = out.text()
    expect(value).toMatch(/^florin_[\w-]+\n$/)
    expect(err.text()).toMatch(/Created MCP token Assistant/)
    expect(data.useMcpToken(value.trim())).toMatchObject({ name: "Assistant" })
    expect(data.listMcpTokens().map((t) => t.name)).toEqual(["Assistant"])
    expect(data.listActivity({ limit: 1 }).items[0]).toMatchObject({
      actor: "person",
      entity: "mcp token",
      summary: "Created MCP token Assistant",
    })
  })

  test("a name of several words; a taken or missing name is refused", () => {
    const out = capture()
    token(["Claude", "laptop"], out, capture())
    expect(data.listMcpTokens().map((t) => t.name)).toContain("Claude laptop")
    expect(() => token(["assistant"], capture(), capture())).toThrow(
      /already exists/
    )
    expect(() => token([], capture(), capture())).toThrow(
      /give the token a name/
    )
  })
})
