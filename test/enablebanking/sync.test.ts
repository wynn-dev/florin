import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { useTempHome } from "../setup"
import { fixture, startFakeEnableBanking } from "./fake"
import * as data from "@/server/data"
import {
  completeLink,
  disconnectLink,
  enableBankingStatus,
  listBankLinks,
  mapAccounts,
  renewLink,
  setCredentials,
  setSyncHours,
  startLink,
  syncDueLinks,
  syncLink,
} from "@/server/enablebanking"
import {
  mapTransactions,
  parseAmount,
  pickBalance,
} from "@/server/enablebanking/sync"
import { getSecret } from "@/server/secrets"
import { sourceName } from "@/components/source-label"
import { callTool } from "@/server/mcp/tool"
import { listBankLinksTool, syncBanks } from "@/server/mcp/tools/banks"
import type { BankTransaction } from "@/server/enablebanking/client"
import type { FakeEnableBanking } from "./fake"

useTempHome()

const tx = fixture<Record<string, BankTransaction>>("transactions")
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
/** A sandbox transaction moved to `offset` days from today. */
function on(
  name: string,
  offset: number,
  patch: Partial<BankTransaction> = {}
): BankTransaction {
  const d = day(offset)
  return {
    ...tx[name],
    booking_date: d,
    value_date: d,
    transaction_date: tx[name].transaction_date ? d : null,
    ...patch,
  }
}

const PSU = { "psu-ip-address": "203.0.113.7", "psu-user-agent": "test" }

let fake: FakeEnableBanking
const current = fake_account()

function fake_account() {
  return {
    hash: "HASH-95641326",
    hashes: ["HASH-34288955", "HASH-95641326", "HASH-42364880"],
    iban: "FI7473834510057469",
    kind: "CACC",
    product: "KÄYTTÖTILI",
    currency: "EUR",
    balances: [
      { type: "ITAV", amount: "-463.66" },
      { type: "ITBD", amount: "-475.76" },
    ],
    transactions: [
      on("donation", -14),
      on("card-purchase", -2),
      on("atm", -1),
      on("child-benefit", -1),
    ],
  }
}

const savings = {
  hash: "HASH-64193017",
  hashes: ["HASH-93258146", "HASH-64193017", "HASH-42364880"],
  iban: "FI2112345600000785",
  kind: "SVGS",
  product: "SÄÄSTÖTILI",
  currency: "EUR",
  balances: [{ type: "ITBD", amount: "1000.00" }],
  transactions: [],
}

beforeAll(async () => {
  fake = await startFakeEnableBanking()
  process.env.FLORIN_ENABLE_BANKING_API = fake.url
  fake.addAccount(current)
  fake.addAccount(savings)
  data.updateSettings("person", { publicUrl: "http://localhost:4680" })
  fake.state.redirectUrls = [
    "http://localhost:4680/connect/enable-banking/callback",
  ]
})
afterAll(async () => {
  delete process.env.FLORIN_ENABLE_BANKING_API
  await fake.close()
})

const txs = (accountId: number) =>
  data.listTransactions({ accountId, limit: 500 }).items

describe("mapping the bank's data", () => {
  test("amounts take their sign from the indicator, without floats", () => {
    expect(parseAmount("1.12", 2)).toBe(112)
    expect(parseAmount("-16.5", 2)).toBe(1650)
    expect(parseAmount("1000", 0)).toBe(1000)
    expect(() => parseAmount("1,12", 2)).toThrow()
    const [debit, credit] = mapTransactions(
      [tx["card-purchase"], tx["child-benefit"]],
      "HASH-1",
      "EUR"
    )
    expect(debit).toMatchObject({
      amount: -112,
      payee: "Wallmart",
      notes: "678944335600 USD 9.39 Gotham City",
      importedId: "er:00000000-0000-4000-8000-000000000006",
      status: "cleared",
    })
    expect(credit).toMatchObject({ amount: 5872, payee: "KELA/FPA" })
  })

  test("a booked row without the bank's id gets a content id, counting identical rows", () => {
    const coffee = { ...tx.atm, entry_reference: null }
    const rows = mapTransactions([coffee, coffee], "HASH-1", "EUR")
    expect(rows[0].importedId).toMatch(/^h:.+#1$/)
    expect(rows[1].importedId).toMatch(/^h:.+#2$/)
    expect(rows[0].importedId.slice(0, -2)).toBe(
      rows[1].importedId.slice(0, -2)
    )
  })

  test("a card's balance is never its available credit", () => {
    const balances = [
      {
        balance_type: "ITAV",
        balance_amount: { currency: "EUR", amount: "3069.05" },
      },
      {
        balance_type: "ITBD",
        balance_amount: { currency: "EUR", amount: "69.05" },
      },
    ]
    expect(pickBalance(balances, "CARD")?.balance_type).toBe("ITBD")
    expect(pickBalance(balances.slice(0, 1), "CARD")).toBeUndefined()
    expect(pickBalance(balances.slice(0, 1), "CACC")?.balance_type).toBe("ITAV")
  })
})

describe("credentials", () => {
  test("are checked with Enable Banking before they're saved", async () => {
    await expect(
      setCredentials({ appId: fake.state.appId, privateKey: "not a key" })
    ).rejects.toThrow("isn't a private key")
    await expect(
      setCredentials({ appId: "wrong-id", privateKey: fake.state.privateKey })
    ).rejects.toThrow("doesn't know this application id")
    const { privateKey: otherKey } = await import("node:crypto").then((c) =>
      c.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      })
    )
    const refused = await setCredentials({
      appId: fake.state.appId,
      privateKey: otherKey,
    }).catch((e: Error) => e.message)
    expect(refused).toMatch(/private key/)
    expect(refused).not.toContain("PRIVATE KEY")
    expect(getSecret("enablebanking.appId")).toBeUndefined()

    await setCredentials({
      appId: fake.state.appId,
      privateKey: fake.state.privateKey,
    })
    const status = await enableBankingStatus()
    expect(status.appId.set).toBe(true)
    expect(status.privateKey.set).toBe(true)
    expect(status.redirectUrl).toBe(
      "http://localhost:4680/connect/enable-banking/callback"
    )
    expect(status.application).toMatchObject({
      environment: "SANDBOX",
      redirectRegistered: true,
    })
    expect(JSON.stringify(status)).not.toContain(fake.state.appId)
    expect(JSON.stringify(status)).not.toContain("PRIVATE KEY")
  })
})

let linkId: number
let currentAccountId: number

describe("linking a bank", () => {
  test("refuses a state florin didn't start, and a cancelled link says so", async () => {
    expect(
      await completeLink(new URLSearchParams({ state: "x", code: "y" }))
    ).toMatch(/^\/accounts\?linkError=/)
    const { url } = await startLink({
      country: "FI",
      bank: "Nordea",
      returnTo: "/settings",
    })
    const back = await completeLink(fake.cancel(url))
    const [path, query] = back.split("?")
    expect(path).toBe("/settings")
    expect(new URLSearchParams(query).get("linkError")).toBe(
      "The bank link was cancelled."
    )
  })

  test("the callback stores the session and asks which account each bank account feeds", async () => {
    await expect(startLink({ country: "FI", bank: "Nobank" })).rejects.toThrow(
      "no bank named Nobank"
    )
    const { url } = await startLink({ country: "FI", bank: "Nordea" })
    const auth = fake.requestsTo("/auth").at(-1)!
    expect(auth.method).toBe("POST")
    const back = await completeLink(fake.approve(url))
    expect(back).toMatch(/^\/accounts\?link=\d+$/)
    linkId = Number(back.split("=")[1])
    const [link] = listBankLinks()
    expect(link).toMatchObject({ id: linkId, bank: "Nordea", state: "active" })
    expect(link.daysLeft).toBeGreaterThan(170)
    expect(
      link.accounts.map((a) => [a.name, a.identifier, a.accountId])
    ).toEqual([
      ["Käyttötili", "FI74 •••• 7469", null],
      ["Säästötili", "FI21 •••• 0785", null],
    ])
  })

  test("a first sync pulls all history, imports it as the bank and matches the bank's balance", async () => {
    const [link] = listBankLinks()
    fake.state.requests.length = 0
    const result = await mapAccounts(
      "person",
      linkId,
      [
        { bankAccountId: link.accounts[0].id, accountId: "new" },
        { bankAccountId: link.accounts[1].id, accountId: null },
      ],
      PSU
    )
    expect(result).toEqual({
      added: 4,
      updated: 0,
      removed: 0,
      matched: 0,
      error: null,
    })
    const pages = fake
      .requestsTo("/accounts")
      .filter((r) => r.path.endsWith("/transactions"))
    expect(pages[0].query.get("strategy")).toBe("longest")
    expect(pages).toHaveLength(2) // two pages of two
    expect(pages[0].headers["psu-ip-address"]).toBe("203.0.113.7")

    const account = data
      .listAccounts()
      .find((a) => a.provider === "enablebanking")!
    currentAccountId = account.id
    expect(account).toMatchObject({
      name: "Nordea ··7469",
      currency: "EUR",
      onBudget: true,
      externalId: "HASH-95641326",
      balance: -47576,
    })
    const rows = txs(account.id)
    expect(rows).toHaveLength(5)
    expect(rows.find((t) => t.payeeName === "Starting balance")?.date).toBe(
      day(-15)
    )
    const actors = data.listActivity({ actor: "bank-sync:" }).items
    expect(actors[0].actor).toBe("bank-sync:Nordea")
    expect(listBankLinks()[0].accounts[0]).toMatchObject({
      accountId: account.id,
      bankBalance: -47576,
    })
  })

  test("a second fetch of the same data adds nothing", async () => {
    const result = await syncLink(linkId, { psu: PSU })
    expect(result).toEqual({
      added: 0,
      updated: 0,
      removed: 0,
      matched: 0,
      error: null,
    })
    expect(txs(currentAccountId)).toHaveLength(5)
  })

  test("an incremental sync fetches from a little before the last booked day", async () => {
    current.transactions.push(on("atm", 0, { entry_reference: "new-1" }))
    fake.state.requests.length = 0
    const result = await syncLink(linkId)
    expect(result.added).toBe(1)
    const first = fake
      .requestsTo("/accounts")
      .find((r) => r.path.endsWith("/transactions"))!
    expect(first.query.get("strategy")).toBeNull()
    expect(first.query.get("date_from")).toBe(day(-11))
    // A background sync is unattended: no PSU headers.
    expect(first.headers["psu-ip-address"]).toBeUndefined()
  })
})

describe("pending transactions", () => {
  test("a pending row with the bank's id turns booked in place", async () => {
    current.transactions.push(
      on("card-purchase", 0, {
        entry_reference: "p-1",
        status: "PDNG",
        booking_date: null,
      })
    )
    await syncLink(linkId, { psu: PSU })
    const pending = txs(currentAccountId).find(
      (t) => t.importedId === "er:p-1"
    )!
    expect(pending.status).toBe("pending")
    data.updateTransaction("person", pending.id, { notes: "lunch" })

    current.transactions.pop()
    current.transactions.push(
      on("card-purchase", 0, { entry_reference: "p-1" })
    )
    const result = await syncLink(linkId, { psu: PSU })
    expect(result).toMatchObject({ added: 0, updated: 1 })
    const booked = txs(currentAccountId).find((t) => t.importedId === "er:p-1")!
    expect(booked).toMatchObject({
      id: pending.id,
      status: "cleared",
      notes: "lunch",
    })
  })

  test("a pending row without an id becomes its booked row, keeping its category", async () => {
    const before = txs(currentAccountId).length
    current.transactions.push(
      on("atm", 0, {
        entry_reference: null,
        status: "PDNG",
        booking_date: null,
        transaction_amount: { currency: "EUR", amount: "7.50" },
      })
    )
    await syncLink(linkId, { psu: PSU })
    const provisional = txs(currentAccountId).find((t) =>
      t.importedId?.startsWith("pend:")
    )!
    expect(provisional.status).toBe("pending")
    const groceries = data
      .listCategoryGroups()
      .flatMap((g) => g.categories)
      .find((c) => c.name === "Groceries")!
    data.updateTransaction("person", provisional.id, {
      categoryId: groceries.id,
    })

    current.transactions.pop()
    current.transactions.push(
      on("atm", 0, {
        entry_reference: "b-1",
        transaction_amount: { currency: "EUR", amount: "7.50" },
      })
    )
    const result = await syncLink(linkId, { psu: PSU })
    expect(result).toMatchObject({ added: 0, updated: 1, removed: 0 })
    const rows = txs(currentAccountId)
    expect(rows).toHaveLength(before + 1)
    expect(rows.find((t) => t.id === provisional.id)).toMatchObject({
      importedId: "er:b-1",
      status: "cleared",
      categoryId: groceries.id,
    })
  })

  test("a pending row the bank drops is removed", async () => {
    const before = txs(currentAccountId).length
    current.transactions.push(
      on("atm", 0, {
        entry_reference: null,
        status: "PDNG",
        booking_date: null,
        transaction_amount: { currency: "EUR", amount: "3.10" },
      })
    )
    expect((await syncLink(linkId, { psu: PSU })).added).toBe(1)
    current.transactions.pop()
    expect(await syncLink(linkId, { psu: PSU })).toMatchObject({
      added: 0,
      removed: 1,
    })
    expect(txs(currentAccountId)).toHaveLength(before)
  })

  const category = (name: string) =>
    data
      .listCategoryGroups()
      .flatMap((g) => g.categories)
      .find((c) => c.name === name)!

  test("a categorised hold that books at another amount leaves one row, category kept", async () => {
    const before = txs(currentAccountId).length
    const hold = on("card-purchase", -1, {
      entry_reference: "hold-1",
      status: "PDNG",
      booking_date: null,
      creditor: { name: "Neste" },
      transaction_amount: { currency: "EUR", amount: "50.00" },
    })
    current.transactions.push(hold)
    await syncLink(linkId, { psu: PSU })
    const pending = txs(currentAccountId).find(
      (t) => t.importedId === "er:hold-1"
    )!
    data.updateTransaction("mcp:agent", pending.id, {
      categoryId: category("Transport").id,
    })

    current.transactions.splice(current.transactions.indexOf(hold), 1)
    current.transactions.push(
      on("card-purchase", 0, {
        entry_reference: "fuel-1",
        creditor: { name: "Neste" },
        transaction_amount: { currency: "EUR", amount: "43.20" },
      })
    )
    expect(await syncLink(linkId, { psu: PSU })).toMatchObject({
      added: 0,
      updated: 1,
      removed: 0,
    })
    const rows = txs(currentAccountId)
    expect(rows).toHaveLength(before + 1)
    expect(rows.find((t) => t.id === pending.id)).toMatchObject({
      importedId: "er:fuel-1",
      status: "cleared",
      amount: -4320,
      categoryId: category("Transport").id,
    })
  })

  test("an expired hold goes, even with a category", async () => {
    const before = txs(currentAccountId).length
    const hold = on("card-purchase", 0, {
      entry_reference: "hotel-hold",
      status: "PDNG",
      booking_date: null,
      creditor: { name: "Hotel Kämp" },
      transaction_amount: { currency: "EUR", amount: "200.00" },
    })
    current.transactions.push(hold)
    await syncLink(linkId, { psu: PSU })
    const pending = txs(currentAccountId).find(
      (t) => t.importedId === "er:hotel-hold"
    )!
    data.updateTransaction("person", pending.id, {
      categoryId: category("Holidays").id,
    })
    current.transactions.splice(current.transactions.indexOf(hold), 1)
    expect(await syncLink(linkId, { psu: PSU })).toMatchObject({
      added: 0,
      removed: 1,
    })
    expect(txs(currentAccountId)).toHaveLength(before)
  })
})

describe("holds that stay pending past the overlap", () => {
  test("a long hold that books, or is dropped, is still reconciled", async () => {
    const before = txs(currentAccountId).length
    // Imported weeks ago, while they were recent; much has booked since.
    data.importTransactions(`bank-sync:Nordea`, currentAccountId, [
      {
        date: day(-20),
        amount: -30000,
        payee: "Hertz",
        importedId: "er:rental-hold",
        status: "pending",
      },
      {
        date: day(-25),
        amount: -15000,
        payee: "Hotel Kämp",
        importedId: "er:hotel-deposit",
        status: "pending",
      },
    ])
    current.transactions.push(
      on("card-purchase", -14, {
        entry_reference: "rental-final",
        creditor: { name: "Hertz" },
        transaction_amount: { currency: "EUR", amount: "280.00" },
      })
    )
    fake.state.requests.length = 0
    expect(await syncLink(linkId, { psu: PSU })).toMatchObject({
      added: 0,
      updated: 1,
      removed: 1,
    })
    const first = fake
      .requestsTo("/accounts")
      .find((r) => r.path.endsWith("/transactions"))!
    expect(first.query.get("date_from")).toBe(day(-25))
    const rows = txs(currentAccountId)
    expect(rows).toHaveLength(before + 1)
    expect(rows.find((t) => t.importedId === "er:rental-final")).toMatchObject({
      status: "cleared",
      amount: -28000,
    })
    expect(rows.some((t) => t.status === "pending")).toBe(false)
  })
})

describe("who made the change", () => {
  test("bank syncs read as the bank's name", () => {
    expect(sourceName("bank-sync:Nordea")).toBe("Nordea sync")
    expect(sourceName("bank-sync")).toBe("Bank sync")
  })
})

describe("the bank's limits and consent", () => {
  test("a rate limit stops that account until later; a sync the person starts still goes", async () => {
    fake.failNext("GET /accounts", {
      status: 429,
      body: {
        code: 429,
        message: "Rate limit exceeded",
        error: "ASPSP_RATE_LIMIT_EXCEEDED",
        detail: null,
      },
    })
    const limited = await syncLink(linkId)
    expect(limited.error).toMatch(/limit/)
    const [link] = listBankLinks()
    expect(link.lastError).toMatch(/limit/)
    expect(Date.parse(link.accounts[0].nextAttemptAt!)).toBeGreaterThan(
      Date.now() + 5 * 3600_000
    )

    fake.state.requests.length = 0
    await syncLink(linkId)
    expect(fake.requestsTo("/accounts")).toHaveLength(0)

    const person = await syncLink(linkId, { psu: PSU })
    expect(person.error).toBeNull()
    expect(listBankLinks()[0]).toMatchObject({ lastError: null })
    expect(listBankLinks()[0].accounts[0].nextAttemptAt).toBeNull()
  })

  test("the scheduled job syncs only links whose interval has passed", async () => {
    setSyncHours(12)
    fake.state.requests.length = 0
    await syncDueLinks()
    expect(fake.requestsTo("/accounts")).toHaveLength(0)
    expect(() => setSyncHours(8)).toThrow("6, 12 or 24")
    setSyncHours(6)
  })

  test("expired access marks the link expired and says to renew", async () => {
    fake.failNext("GET /accounts", {
      status: 401,
      body: {
        code: 401,
        message: "Session is expired",
        error: "EXPIRED_SESSION",
        detail: null,
      },
    })
    const result = await syncLink(linkId)
    expect(result.error).toMatch(/expired.*Renew/)
    const [link] = listBankLinks()
    expect(link.state).toBe("expired")
    fake.state.requests.length = 0
    expect((await syncLink(linkId)).error).toMatch(/expired/)
    expect(fake.requestsTo("/accounts")).toHaveLength(0)
  })

  test("renewing makes a new session and keeps the account mapping", async () => {
    const before = listBankLinks()[0]
    const oldSessions = [...fake.state.sessions.keys()]
    const { url } = await renewLink(linkId, "/settings")
    const back = await completeLink(fake.approve(url), PSU)
    expect(back).toBe(`/settings?linked=${linkId}`)
    await syncLink(linkId, { psu: PSU })
    const after = listBankLinks()[0]
    expect(after).toMatchObject({
      id: linkId,
      state: "active",
      lastError: null,
    })
    expect(after.accounts.map((a) => [a.id, a.accountId])).toEqual(
      before.accounts.map((a) => [a.id, a.accountId])
    )
    // The old session is left to lapse: deleting it can end the new one's access too.
    expect(
      fake.requestsTo("/sessions").filter((r) => r.method === "DELETE")
    ).toEqual([])
    expect(fake.state.sessions.get(oldSessions.at(-1)!)?.status).toBe(
      "AUTHORIZED"
    )
    current.transactions.push(on("atm", 0, { entry_reference: "after-renew" }))
    expect((await syncLink(linkId, { psu: PSU })).added).toBe(1)
  })

  test("agents see bank links and sync them over MCP", async () => {
    const ctx = { actor: () => "mcp:test" as const }
    const listed = await callTool(listBankLinksTool, {}, ctx)
    const { links } = JSON.parse(
      (listed.content[0] as { text: string }).text
    ) as { links: { id: number; state: string; accounts: unknown[] }[] }
    expect(links).toMatchObject([
      {
        id: linkId,
        state: "active",
        accounts: [{ accountId: currentAccountId }, { accountId: null }],
      },
    ])
    current.transactions.push(on("atm", 0, { entry_reference: "via-mcp" }))
    const synced = await callTool(syncBanks, { linkId }, ctx)
    expect(
      JSON.parse((synced.content[0] as { text: string }).text)
    ).toMatchObject({
      added: 1,
      error: null,
    })
  })

  test("disconnecting keeps the transactions", async () => {
    const count = txs(currentAccountId).length
    await disconnectLink("person", linkId)
    expect(listBankLinks()).toEqual([])
    expect(txs(currentAccountId)).toHaveLength(count)
    expect(data.getAccount(currentAccountId).provider).toBeNull()
  })
})

describe("linking to an account that already has transactions", () => {
  test("bank rows attach to typed-in and CSV rows instead of doubling them", async () => {
    const joint = data.createAccount("person", {
      name: "Joint",
      type: "checking",
    })
    const groceries = data
      .listCategoryGroups()
      .flatMap((g) => g.categories)
      .find((c) => c.name === "Groceries")!
    // Typed in a day off from the bank's date, with the person's own payee and category.
    const typed = data.createTransaction("person", {
      accountId: joint.id,
      date: day(-13),
      amount: -1425,
      payeeName: "Charity",
      categoryId: groceries.id,
      notes: "monthly gift",
    })
    // From a CSV export of the same account.
    data.importTransactions("import", joint.id, [
      { date: day(-2), amount: -112, payee: "WALLMART 1234" },
    ])

    const { url } = await startLink({ country: "FI", bank: "Nordea" })
    const back = await completeLink(fake.approve(url))
    const newLink = Number(back.split("=")[1])
    const link = listBankLinks().find((l) => l.id === newLink)!
    const bankRow = link.accounts.find((a) => a.identifier.endsWith("7469"))!
    const others = link.accounts.filter((a) => a !== bankRow)
    const result = await mapAccounts(
      "person",
      newLink,
      [
        { bankAccountId: bankRow.id, accountId: joint.id },
        ...others.map((a) => ({ bankAccountId: a.id, accountId: null })),
      ],
      PSU
    )
    const booked = current.transactions.filter((t) => t.status === "BOOK")
    expect(result).toMatchObject({
      matched: 2,
      added: booked.length - 2,
      error: null,
    })

    const rows = txs(joint.id)
    expect(rows).toHaveLength(booked.length)
    expect(rows.find((t) => t.id === typed.id)).toMatchObject({
      payeeName: "Charity",
      categoryId: groceries.id,
      notes: "monthly gift",
      importedId: "er:00000000-0000-4000-8000-000000000009",
    })
    const bankTotal = mapTransactions(booked, "HASH-95641326", "EUR").reduce(
      (sum, r) => sum + r.amount,
      0
    )
    expect(data.getAccount(joint.id).balance).toBe(bankTotal)
    // And again: nothing new.
    expect(await syncLink(newLink, { psu: PSU })).toMatchObject({
      added: 0,
      matched: 0,
    })
  })
})

describe("the person's rows and deletions", () => {
  test("a typed-in row matched to a pending bank row is unmatched, not deleted, when the bank drops it", async () => {
    const link = listBankLinks()[0].id
    const accountId = listBankLinks()[0].accounts.find(
      (a) => a.accountId !== null && a.identifier.endsWith("7469")
    )!.accountId!
    const typed = data.createTransaction("person", {
      accountId,
      date: day(0),
      amount: -777,
      payeeName: "Corner shop",
      notes: "typed in",
    })
    current.transactions.push(
      on("atm", 0, {
        entry_reference: null,
        status: "PDNG",
        booking_date: null,
        transaction_amount: { currency: "EUR", amount: "7.77" },
      })
    )
    expect((await syncLink(link, { psu: PSU })).matched).toBe(1)
    expect(data.getTransaction(typed.id).importedId).toMatch(/^pend:/)
    current.transactions.pop()
    expect(await syncLink(link, { psu: PSU })).toMatchObject({ removed: 0 })
    expect(data.getTransaction(typed.id)).toMatchObject({
      importedId: null,
      status: "cleared",
      notes: "typed in",
    })
    data.deleteTransaction("person", typed.id)
  })

  test("a bank row the person deletes stays deleted on the next sync; Undo brings it back for good", async () => {
    const link = listBankLinks()[0]
    const accountId = link.accounts.find(
      (a) => a.accountId !== null && a.identifier.endsWith("7469")
    )!.accountId!
    const bankRow = txs(accountId).find(
      (t) => t.importedId?.startsWith("er:") && t.status === "cleared"
    )!
    const before = txs(accountId).length
    data.deleteTransactions("person", [bankRow.id])
    expect(await syncLink(link.id, { psu: PSU })).toMatchObject({ added: 0 })
    expect(txs(accountId)).toHaveLength(before - 1)
    // Undo puts it back with its bank id; it isn't duplicated or skipped later.
    data.createTransaction("person", {
      accountId,
      date: bankRow.date,
      amount: bankRow.amount,
      importedId: bankRow.importedId,
    })
    expect(await syncLink(link.id, { psu: PSU })).toMatchObject({ added: 0 })
    expect(txs(accountId)).toHaveLength(before)
  })
})
