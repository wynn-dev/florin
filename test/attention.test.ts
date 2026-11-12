import { afterAll, describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"
import { registerJob, resetJobs, runJobNow } from "@/server/jobs"
import { db, schema } from "@/server/db"
import { TOKEN_KEY } from "@/server/ibkr/sync"
import { setSecret } from "@/server/secrets"
import { today } from "@/server/data/validate"

useTempHome()
afterAll(() => resetJobs())

const HOUR = 3_600_000
const later = (hours: number) => new Date(Date.now() + hours * HOUR)
const texts = (now?: Date) => data.needsAttention(now).items.map((i) => i.text)

function categoryId(name: string): number {
  return data
    .listCategoryGroups()
    .flatMap((g) => g.categories)
    .find((c) => c.name === name)!.id
}

describe("needs attention", () => {
  let account: number

  test("nothing at first, and no grace period while no MCP client has been seen", () => {
    expect(data.needsAttention()).toEqual({ items: [], graceHours: 0 })
  })

  test("with no agent around, agent items show at once, without an age", () => {
    account = data.createAccount("person", {
      name: "Current",
      type: "checking",
    }).id
    data.createTransaction("person", {
      accountId: account,
      date: today(),
      amount: -1_250,
      payeeName: "Kiosk",
    })
    const [item] = data.needsAttention().items
    expect(item).toMatchObject({
      id: "uncategorized",
      who: "agent",
      text: "1 transaction uncategorised",
      action: {
        label: "Review",
        to: "/transactions",
        search: { uncategorized: true },
      },
    })
  })

  test("once an MCP client is about, agent items wait 24 hours and then say how long", () => {
    data.createPayee("mcp:Claude Desktop", "Bakery")
    expect(data.needsAttention().graceHours).toBe(24)
    expect(texts()).toEqual([])
    expect(texts(later(23))).toEqual([])
    expect(texts(later(25))).toEqual([
      "1 transaction uncategorised for over a day",
    ])
    expect(texts(later(24 * 3 + 1))).toEqual([
      "1 transaction uncategorised for 3 days",
    ])
  })

  test("a token used in the last seven days counts as an agent about", () => {
    expect(data.needsAttention(later(24 * 8)).graceHours).toBe(0)
    const { token } = data.createMcpToken("person", "Claude Desktop")
    expect(data.useMcpToken(token)).not.toBeNull()
    expect(data.needsAttention(later(24 * 6)).graceHours).toBe(24)
  })

  test("transfers and tracking accounts need no category", () => {
    const savings = data.createAccount("person", {
      name: "Savings",
      type: "savings",
    }).id
    data.createTransaction("person", {
      accountId: account,
      date: today(),
      amount: -5_000,
      transferAccountId: savings,
    })
    const usd = data.createAccount("person", {
      name: "US",
      type: "checking",
      currency: "USD",
    }).id
    data.createTransaction("person", {
      accountId: usd,
      date: today(),
      amount: -700,
      payeeName: "Deli",
    })
    expect(texts(later(25))).toEqual([
      "1 transaction uncategorised for over a day",
    ])
  })

  test("an overspent category, since it went over; money not planned yet, since it arrived", () => {
    const month = today().slice(0, 7)
    data.createTransaction("person", {
      accountId: account,
      date: today(),
      amount: 100_000,
      payeeName: "Employer",
      categoryId: categoryId("Income"),
    })
    data.setBudgetAmount("person", month, categoryId("Dining out"), 3_000)
    data.createTransaction("person", {
      accountId: account,
      date: today(),
      amount: -7_210,
      payeeName: "Bistro",
      categoryId: categoryId("Dining out"),
    })
    // Both started this second; the uncategorised one is older.
    const items = data.needsAttention(later(25)).items
    const byId = (id: string) => items.find((i) => i.id === id)
    expect(items).toHaveLength(3)
    expect(items[0].id).toBe("uncategorized")
    expect(byId("unassigned")).toMatchObject({
      text: expect.stringMatching(
        /^€970 not planned yet since (yesterday|\w+day)$/
      ),
      action: { label: "Plan", to: `/budget/${month}` },
    })
    expect(byId(`overspent:${categoryId("Dining out")}`)).toMatchObject({
      text: expect.stringMatching(
        /^Dining out has been €42.10 over plan since (yesterday|\w+day)$/
      ),
      action: { label: "Cover", to: `/budget/${month}` },
    })
    // Covering it and assigning the rest clears both.
    data.setBudgetAmount("person", month, categoryId("Dining out"), 7_210)
    data.setBudgetAmount(
      "person",
      month,
      categoryId("Groceries"),
      100_000 - 7_210
    )
    expect(data.needsAttention(later(25)).items.map((i) => i.id)).toEqual([
      "uncategorized",
    ])
  })

  test("a bank link's access and sync errors show at once and first, from the link itself", async () => {
    // The job's own error is no longer what counts.
    registerJob({
      name: "enable-banking",
      everyMs: HOUR,
      run: () => {
        throw new Error("the bank did not answer")
      },
    })
    await runJobNow("enable-banking")
    expect(data.needsAttention().items.some((i) => i.who === "person")).toBe(
      false
    )

    const days = (n: number) =>
      new Date(Date.now() + n * 24 * HOUR).toISOString()
    const link = (bank: string, validUntil: string, lastError?: string) =>
      db()
        .insert(schema.ebLinks)
        .values({
          sessionId: `session-${bank}`,
          bank,
          country: "FI",
          validUntil,
          lastError: lastError ?? null,
          lastAttemptAt: new Date().toISOString(),
        })
        .returning({ id: schema.ebLinks.id })
        .get().id
    const fine = link("Fine Bank", days(90))
    const failing = link(
      "Nordea",
      days(90),
      "The bank did not answer. Try later."
    )
    const ending = link("OP", days(5.5))
    const ended = link("S-Pankki", days(-2))
    const person = data.needsAttention().items.filter((i) => i.who === "person")
    const byId = new Map(person.map((i) => [i.id, i]))
    expect(byId.has(`bank:${fine}`)).toBe(false)
    expect(byId.get(`bank:${failing}`)).toMatchObject({
      text: "Bank sync failed: the bank did not answer",
      action: {
        label: "Retry",
        post: `/api/connections/enable-banking/links/${failing}/sync`,
      },
    })
    const renew = (id: number) => ({
      label: "Renew",
      post: `/api/connections/enable-banking/links/${id}/renew`,
      body: { returnTo: "/" },
    })
    expect(byId.get(`bank:${ending}`)).toMatchObject({
      text: expect.stringMatching(/^OP access ends on \d{1,2} \w{3}/),
      action: renew(ending),
    })
    expect(byId.get(`bank:${ended}`)).toMatchObject({
      text: "S-Pankki access ended",
      action: renew(ended),
    })
    // The person's items come first.
    const items = data.needsAttention().items
    expect(items.slice(0, person.length).every((i) => i.who === "person")).toBe(
      true
    )
  })

  test("a failed IBKR report comes from the connector's state, its fix from the kind of error", () => {
    const ibkrItem = () =>
      data.needsAttention().items.find((i) => i.id === "ibkr")
    const settings = {
      to: "/settings",
      search: { section: "connections" },
      hash: "ibkr",
    }
    const failed = (lastError: string | null, needsPerson: boolean) =>
      db()
        .insert(schema.ibkr)
        .values({
          id: 1,
          queryId: "123456",
          lastError,
          needsPerson,
          lastPullAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: schema.ibkr.id,
          set: { lastError, needsPerson },
        })
        .run()

    // Not connected: an old error is no item.
    failed("Your IBKR Flex token has expired. Create a new one.", true)
    expect(ibkrItem()).toBeUndefined()

    setSecret(TOKEN_KEY, "1234567890123456")
    expect(ibkrItem()).toMatchObject({
      who: "person",
      text: "IBKR report failed: your IBKR Flex token has expired",
      action: { label: "Update token", ...settings },
    })
    // It stays while the daily pull is stopped, whatever the jobs table says.
    failed(
      "The Flex query lacks the Open Positions section. Tick it in Client Portal.",
      true
    )
    expect(ibkrItem()).toMatchObject({
      text: "IBKR report failed: the Flex query lacks the Open Positions section",
      action: { label: "Open settings", ...settings },
    })
    // A passing failure can be retried; a pull that works clears it.
    failed("IBKR didn't answer. Try again later.", false)
    expect(ibkrItem()?.action).toEqual({
      label: "Retry",
      post: "/api/connections/ibkr/pull",
    })
    failed(null, false)
    expect(ibkrItem()).toBeUndefined()
  })

  test("at most five items", () => {
    for (const name of ["Groceries", "Transport", "Shopping", "Rent"])
      data.createTransaction("person", {
        accountId: account,
        date: today(),
        amount: -200_000,
        payeeName: "Shop",
        categoryId: categoryId(name),
      })
    const items = data.needsAttention(later(25)).items
    expect(items).toHaveLength(5)
    expect(items[0].who).toBe("person")
  })
})
