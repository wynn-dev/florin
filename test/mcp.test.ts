// The MCP driven by the SDK's own client over streamable HTTP (the /mcp
// handler, with and without a token), against a real database in a temporary
// folder.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"
import { handleMcpRequest } from "@/server/mcp/http"
import { tools } from "@/server/mcp/tools"

useTempHome()

const MONTH = new Date().toISOString().slice(0, 7)
const day = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`

function categoryId(name: string): number {
  for (const g of data.listCategoryGroups()) {
    const c = g.categories.find((x) => x.name === name)
    if (c) return c.id
  }
  throw new Error(`no category ${name}`)
}

let checking: number
beforeAll(() => {
  checking = data.createAccount("person", {
    name: "Checking",
    type: "checking",
    startingBalance: 200_000,
    startingDate: day(1),
  }).id
  data.importTransactions("import", checking, [
    { date: day(1), amount: -4_250, payee: "LIDL 1234" },
    { date: day(1), amount: -1_890, payee: "Cafe Central" },
    { date: day(1), amount: -95_000, payee: "Landlord" },
    { date: day(1), amount: -3_120, payee: "LIDL 1234" },
  ])
})

/** The /mcp handler as the client's fetch, so requests go through the token check. */
function httpClient(token?: string) {
  const transport = new StreamableHTTPClientTransport(
    new URL("http://florin.test/mcp"),
    {
      requestInit: token
        ? { headers: { authorization: `Bearer ${token}` } }
        : undefined,
      fetch: (url, init) => handleMcpRequest(new Request(url, init)),
    }
  )
  return { client: new Client({ name: "test", version: "1.0.0" }), transport }
}

type Result = { isError?: boolean; content: { type: string; text: string }[] }

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
) {
  const result = (await client.callTool({ name, arguments: args })) as Result
  const text = result.content[0].text
  if (result.isError) throw new Error(text)
  return JSON.parse(text) as Record<string, any>
}

describe("over HTTP", () => {
  let token: { id: number; name: string; token: string }
  let http: ReturnType<typeof httpClient>

  beforeAll(() => {
    token = data.createMcpToken("person", "Claude laptop")
    http = httpClient(token.token)
  })
  afterAll(() => http.client.close())

  test("without a token the answer is a clear 401, even with a session cookie", async () => {
    const response = await handleMcpRequest(
      new Request("http://florin.test/mcp", {
        method: "POST",
        headers: { cookie: "florin_session=whatever" },
        body: "{}",
      })
    )
    expect(response.status).toBe(401)
    expect((await response.json()).error).toMatch(/Authorization: Bearer/)
    const anonymous = httpClient()
    await expect(
      anonymous.client.connect(anonymous.transport)
    ).rejects.toThrow()
  })

  test("lists every tool with annotations", async () => {
    const { client, transport } = httpClient(token.token)
    await client.connect(transport)
    expect(client.getInstructions()).toMatch(/envelope budget/)
    const listed = (await client.listTools()).tools
    expect(listed.map((t) => t.name)).toEqual(tools.map((t) => t.name))
    const byName = new Map(listed.map((t) => [t.name, t]))
    expect(byName.get("overview")!.annotations).toMatchObject({
      readOnlyHint: true,
    })
    expect(byName.get("delete_transactions")!.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    })
    expect(byName.get("update_transactions")!.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    })
    await client.close()
  })

  test("a realistic session, recorded under the token's name", async () => {
    const { client, transport } = http
    await client.connect(transport)

    const lay = await call(client, "overview")
    expect(lay.currency).toBe("EUR")
    expect(lay.accounts).toEqual([
      expect.objectContaining({ name: "Checking", balance: 200_000 - 104_260 }),
    ])
    expect(lay.uncategorized).toBe(4)

    const found = await call(client, "search_transactions", {
      uncategorized: true,
    })
    expect(found.total).toBe(4)
    expect(found.items[0]).toMatchObject({ currency: "EUR" })

    const groceries = categoryId("Groceries")
    const dining = categoryId("Dining out")
    const rent = categoryId("Rent")
    const pick = (payee: string) =>
      payee === "Lidl 1234"
        ? groceries
        : payee === "Cafe Central"
          ? dining
          : rent
    const updated = await call(client, "update_transactions", {
      updates: found.items.map((t: { id: number; payee: string }) => ({
        id: t.id,
        categoryId: pick(t.payee),
      })),
    })
    expect(updated.updated).toBe(4)
    expect((await call(client, "overview")).uncategorized).toBe(0)

    // A foreign account with no exchange rate yet is named, not silently dropped.
    expect(lay.netWorthLeavesOut).toBeUndefined()
    const usd = data.createAccount("person", {
      name: "Broker USD",
      type: "investment",
      currency: "USD",
      startingBalance: 50_000,
    })
    const partial = await call(client, "overview")
    expect(partial.netWorthLeavesOut).toEqual([
      expect.objectContaining({ name: "Broker USD", currency: "USD" }),
    ])
    expect(partial.netWorthNote).toMatch(/exchange rate/)
    data.deleteAccount("person", usd.id)

    const set = await call(client, "set_budget", {
      month: MONTH,
      amounts: [
        { categoryId: groceries, amount: 30_000 },
        { categoryId: dining, amount: 5_000 },
        { categoryId: rent, amount: 95_000 },
      ],
    })
    expect(set).toMatchObject({ budgeted: 130_000, toBudget: 70_000 })

    const moved = await call(client, "move_money", {
      month: MONTH,
      moves: [
        { fromCategoryId: groceries, toCategoryId: dining, amount: 2_000 },
      ],
    })
    expect(moved.toBudget).toBe(70_000)
    expect(moved.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: dining,
          budgeted: 7_000,
          available: 5_110,
        }),
        expect.objectContaining({ id: groceries, budgeted: 28_000 }),
      ])
    )

    const assigned = await call(client, "move_money", {
      month: MONTH,
      moves: [{ fromCategoryId: null, toCategoryId: rent, amount: 1_000 }],
    })
    expect(assigned.toBudget).toBe(69_000)

    const report = await call(client, "get_report", {
      report: "spending",
      from: day(1),
      to: day(28),
    })
    expect(report.currency).toBe("EUR")
    expect(report.rows[0]).toMatchObject({
      categoryName: "Rent",
      amount: 95_000,
    })

    const log = await call(client, "get_activity", { actor: "mcp:" })
    expect(log.total).toBe(4 + 3 + 1 + 1)
    expect(new Set(log.items.map((c: { actor: string }) => c.actor))).toEqual(
      new Set(["mcp:Claude laptop"])
    )
    expect(data.listMcpTokens()[0].lastUsedAt).not.toBeNull()
  })

  test("bulk writes are all or nothing, and the error names the item", async () => {
    const before = data.listTransactions({ accountId: checking }).items
    await expect(
      call(http.client, "update_transactions", {
        updates: [
          { id: before[0].id, notes: "changed" },
          { id: before[1].id, categoryId: 999_999 },
        ],
      })
    ).rejects.toThrow(/item 2 of 2: category 999999 not found/)
    expect(data.getTransaction(before[0].id).notes).toBe("")
  })

  test("a transfer between currencies keeps each side's amount", async () => {
    const usd = data.createAccount("person", {
      name: "Brokerage cash",
      type: "savings",
      currency: "USD",
    })
    const added = await call(http.client, "add_transactions", {
      transactions: [
        {
          accountId: checking,
          date: day(2),
          amount: -10_000,
          transferAccountId: usd.id,
          transferAmount: 10_850,
        },
      ],
    })
    expect(added.items[0]).toMatchObject({
      amount: -10_000,
      currency: "EUR",
      transferAccount: "Brokerage cash",
    })
    const [leg] = data.listTransactions({ accountId: usd.id }).items
    expect(leg.amount).toBe(10_850)
  })

  test("a revoked token is refused", async () => {
    const other = data.createMcpToken("person", "Old phone")
    data.deleteMcpToken("person", other.id)
    const response = await handleMcpRequest(
      new Request("http://florin.test/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${other.token}` },
        body: "{}",
      })
    )
    expect(response.status).toBe(401)
    expect((await response.json()).error).toMatch(/revoked/)
  })
})

describe("tokens", () => {
  test("names are unique and the token is only stored as a hash", () => {
    const created = data.createMcpToken("person", "Agent")
    expect(created.token).toMatch(/^florin_/)
    expect(() => data.createMcpToken("person", "agent")).toThrow(
      /already exists/
    )
    const listed = data.listMcpTokens().find((t) => t.id === created.id)!
    expect(Object.keys(listed).sort()).toEqual(
      ["createdAt", "id", "lastUsedAt", "name"].sort()
    )
    expect(listed.lastUsedAt).toBeNull()
    expect(data.useMcpToken(created.token)?.name).toBe("Agent")
    expect(data.useMcpToken(created.token + "x")).toBeNull()
  })
})
