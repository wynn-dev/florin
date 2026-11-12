// Bank sync through Enable Banking: florin's one bank connector. The person
// sets the application id and key, links a bank through the bank's own page
// (POST /auth → the bank → florin's callback → POST /sessions), maps each bank
// account to a florin account, and florin syncs on a schedule and on demand
// (sync.ts). A link lasts until the access the bank granted ends; renewing it
// makes a new session and keeps the mapping by the accounts' stable hash.
import { randomBytes } from "node:crypto"
import { and, eq, inArray, lt } from "drizzle-orm"
import { db, schema } from "../db"
import {
  createAccount,
  getAccount,
  linkAccount,
  listAccounts,
  publicUrl,
} from "../data"
import { InvalidInput, NotFound } from "../data/validate"
import { EnableBankingError } from "./client"
import { api, application, credentialsInfo } from "./credentials"
import { isSyncing, syncHours, syncLink } from "./sync"
import type { PsuHeaders, Session, SessionAccount } from "./client"
import type { AccountType, Actor } from "@/shared/types"
import type {
  AccountMapping,
  Bank,
  BankAccount,
  BankLink,
  EnableBankingStatus,
  StartLink,
  SyncResult,
} from "@/shared/enablebanking"
import { EXPIRING_DAYS } from "@/shared/enablebanking"

export { setCredentials } from "./credentials"
export {
  setSyncHours,
  syncAll,
  syncDueLinks,
  syncLink,
  SYNC_CHECK_MS,
  SYNC_JOB,
} from "./sync"
export { EnableBankingError } from "./client"

const { ebLinks, ebAccounts, ebPending, accounts } = schema

export const CALLBACK_PATH = "/connect/enable-banking/callback"
/** An authorisation not back from the bank within this long is dropped. */
const PENDING_MS = 30 * 60_000
const MAX_ACCESS_DAYS = 180

export function redirectUrl(): string {
  return publicUrl() + CALLBACK_PATH
}

/** Turns a connector error into the data layer's InvalidInput, so the API answers 400 with its words. */
async function plain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof EnableBankingError)
      throw new InvalidInput(error.message)
    throw error
  }
}

export async function enableBankingStatus(): Promise<EnableBankingStatus> {
  const app = await application()
  const url = redirectUrl()
  return {
    ...credentialsInfo(),
    redirectUrl: url,
    application:
      app && !(app instanceof EnableBankingError)
        ? {
            name: app.name,
            environment: app.environment,
            active: app.active,
            redirectRegistered: (app.redirect_urls ?? []).includes(url),
            countries: [...(app.countries ?? [])].sort(),
          }
        : null,
    applicationError: app instanceof EnableBankingError ? app.message : null,
    syncHours: syncHours(),
    links: listBankLinks(),
  }
}

/** "FI7473834510057469" → "FI74 •••• 7469"; a card's masked number as the bank gives it. */
export function maskIdentifier(a: SessionAccount): string {
  const iban = a.account_id?.iban?.replace(/\s+/g, "")
  if (iban) return `${iban.slice(0, 4)} •••• ${iban.slice(-4)}`
  const other = a.account_id?.other?.identification?.trim()
  if (other) return other.length > 8 ? `•••• ${other.slice(-4)}` : other
  return ""
}

export function listBankLinks(): BankLink[] {
  const now = Date.now()
  const links = db()
    .select()
    .from(ebLinks)
    .orderBy(ebLinks.bank, ebLinks.id)
    .all()
  if (!links.length) return []
  const rows = db()
    .select()
    .from(ebAccounts)
    .where(
      inArray(
        ebAccounts.linkId,
        links.map((l) => l.id)
      )
    )
    .orderBy(ebAccounts.id)
    .all()
  const florin = listAccounts()
  const byExternal = new Map(
    florin
      .filter((a) => a.provider === "enablebanking" && a.externalId)
      .map((a) => [a.externalId!, a.id])
  )
  return links.map((link) => {
    const daysLeft = Math.floor(
      (Date.parse(link.validUntil) - now) / 86_400_000
    )
    const state =
      link.status !== "active"
        ? link.status
        : Date.parse(link.validUntil) <= now
          ? "expired"
          : daysLeft < EXPIRING_DAYS
            ? "expiring"
            : "active"
    return {
      id: link.id,
      bank: link.bank,
      country: link.country,
      state,
      validUntil: link.validUntil,
      daysLeft,
      lastSyncAt: link.lastSyncAt,
      lastError: link.lastError,
      syncing: isSyncing(link.id),
      accounts: rows
        .filter((r) => r.linkId === link.id)
        .map((r): BankAccount => {
          return {
            id: r.id,
            name: r.name,
            identifier: r.identifier,
            currency: r.currency,
            kind: r.kind,
            accountId: r.accountId,
            accountName: florin.find((a) => a.id === r.accountId)?.name ?? null,
            suggestedAccountId:
              r.accountId ?? byExternal.get(r.identificationHash) ?? null,
            lastSyncedAt: r.lastSyncedAt,
            nextAttemptAt: r.nextAttemptAt,
            bankBalance: r.bankBalance,
            bankBalanceAt: r.bankBalanceAt,
          }
        }),
    }
  })
}

function getLink(id: number) {
  const link = db().select().from(ebLinks).where(eq(ebLinks.id, id)).get()
  if (!link) throw new NotFound("bank link not found")
  return link
}

export function listBanks(country: unknown): Promise<Bank[]> {
  if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) {
    throw new InvalidInput("country must be a two-letter code like FI")
  }
  return plain(async () =>
    (await api().banks(country))
      .map((b) => ({
        name: b.name,
        country: b.country,
        logo: b.logo ?? null,
        maxAccessDays: Math.floor(
          (b.maximum_consent_validity ?? MAX_ACCESS_DAYS * 86_400) / 86_400
        ),
        beta: Boolean(b.beta),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  )
}

function checkReturnTo(value: unknown): string {
  if (value === undefined || value === null || value === "") return "/accounts"
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    throw new InvalidInput("returnTo must be a path on florin, like /accounts")
  }
  return value
}

async function startAuth(
  bank: string,
  country: string,
  returnTo: string,
  linkId: number | null
) {
  const client = api()
  const found = (await client.banks(country)).find((b) => b.name === bank)
  if (!found)
    throw new InvalidInput(
      `Enable Banking has no bank named ${bank} in ${country}.`
    )
  // As long as the bank allows, less an hour, and at most 180 days.
  const seconds = Math.min(
    (found.maximum_consent_validity ?? MAX_ACCESS_DAYS * 86_400) - 3600,
    MAX_ACCESS_DAYS * 86_400
  )
  const state = randomBytes(32).toString("base64url")
  const now = new Date()
  db()
    .delete(ebPending)
    .where(
      lt(
        ebPending.createdAt,
        new Date(now.getTime() - PENDING_MS).toISOString()
      )
    )
    .run()
  db()
    .insert(ebPending)
    .values({
      state,
      bank,
      country,
      linkId,
      returnTo,
      createdAt: now.toISOString(),
    })
    .run()
  const { url } = await client.startAuth({
    access: {
      valid_until: new Date(now.getTime() + seconds * 1000).toISOString(),
    },
    aspsp: { name: bank, country },
    state,
    redirect_url: redirectUrl(),
    psu_type: "personal",
    language: "en",
  })
  return { url }
}

/** Starts linking a bank: answers the bank's address to send the browser to. */
export function startLink(input: StartLink): Promise<{ url: string }> {
  if (!input || typeof input.bank !== "string" || !input.bank.trim())
    throw new InvalidInput("pick a bank")
  if (typeof input.country !== "string" || !/^[A-Z]{2}$/.test(input.country)) {
    throw new InvalidInput("country must be a two-letter code like FI")
  }
  const returnTo = checkReturnTo(input.returnTo)
  return plain(() =>
    startAuth(input.bank.trim(), input.country, returnTo, null)
  )
}

/** Renews a link's access through the bank; answers the bank's address to send the browser to. */
export function renewLink(
  linkId: number,
  returnTo?: unknown
): Promise<{ url: string }> {
  const link = getLink(linkId)
  const back = checkReturnTo(returnTo)
  return plain(() => startAuth(link.bank, link.country, back, link.id))
}

function withParams(path: string, params: Record<string, string>): string {
  const url = new URL(path, "http://florin")
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.pathname + url.search + url.hash
}

function kindToType(kind: string): AccountType {
  if (kind === "CARD") return "credit"
  if (kind === "SVGS") return "savings"
  return "checking"
}

function accountValues(a: SessionAccount) {
  const title = (s: string) =>
    s === s.toUpperCase()
      ? s
          .toLowerCase()
          .replace(
            /(^|[^\p{L}])(\p{L})/gu,
            (_, before: string, c: string) => before + c.toUpperCase()
          )
      : s
  const kind = a.cash_account_type || "CACC"
  return {
    uid: a.uid!,
    identificationHash: a.identification_hash,
    hashes: JSON.stringify(a.identification_hashes ?? []),
    name: title(
      (
        a.product ||
        a.details ||
        a.name ||
        (kind === "CARD" ? "Card" : "Account")
      ).trim()
    ),
    identifier: maskIdentifier(a),
    currency: a.currency && a.currency !== "XXX" ? a.currency : "",
    kind,
  }
}

/**
 * Pairs a new session's accounts with a link's stored ones: by the
 * identification hash, then by IBAN or card number, then by a secondary hash
 * that only that one account has (banks give accounts shared hashes, and list
 * them in a different order each session).
 */
export function matchAccounts(
  existing: (typeof ebAccounts.$inferSelect)[],
  incoming: SessionAccount[]
): Map<SessionAccount, number> {
  const count = new Map<string, number>()
  for (const a of incoming)
    for (const h of new Set([
      a.identification_hash,
      ...(a.identification_hashes ?? []),
    ]))
      count.set(h, (count.get(h) ?? 0) + 1)
  for (const e of existing)
    for (const h of new Set([
      e.identificationHash,
      ...(JSON.parse(e.hashes) as string[]),
    ]))
      count.set(h, (count.get(h) ?? 0) + 1)
  const own = (h: string) => count.get(h) === 2 // once in each list
  const rules: ((
    e: (typeof existing)[number],
    a: SessionAccount
  ) => boolean)[] = [
    (e, a) => e.identificationHash === a.identification_hash,
    (e, a) =>
      e.identifier !== "" &&
      e.identifier === maskIdentifier(a) &&
      e.currency === (a.currency ?? ""),
    (e, a) => {
      const theirs = new Set([
        a.identification_hash,
        ...(a.identification_hashes ?? []),
      ])
      return [e.identificationHash, ...(JSON.parse(e.hashes) as string[])].some(
        (h) => theirs.has(h) && own(h)
      )
    },
  ]
  const matches = new Map<SessionAccount, number>()
  const taken = new Set<number>()
  for (const rule of rules) {
    for (const a of incoming) {
      if (matches.has(a)) continue
      const e = existing.find((x) => !taken.has(x.id) && rule(x, a))
      if (e) {
        matches.set(a, e.id)
        taken.add(e.id)
      }
    }
  }
  return matches
}

/** Stores a new session: as a new link, or into the link it renews (or that already has its accounts). */
function saveSession(
  session: Session,
  renewing: number | null
): { linkId: number; unmapped: boolean } {
  const usable = session.accounts.filter((a) => a.uid && a.identification_hash)
  return db().transaction((tx) => {
    let linkId = renewing
    if (linkId === null) {
      // Linking a bank that is already linked counts as renewing it.
      const all = new Set(usable.map((a) => a.identification_hash))
      const same = tx
        .select({
          linkId: ebAccounts.linkId,
          hash: ebAccounts.identificationHash,
        })
        .from(ebAccounts)
        .innerJoin(ebLinks, eq(ebLinks.id, ebAccounts.linkId))
        .where(
          and(
            eq(ebLinks.bank, session.aspsp.name),
            eq(ebLinks.country, session.aspsp.country)
          )
        )
        .all()
        .find((r) => all.has(r.hash))
      linkId = same?.linkId ?? null
    }
    const values = {
      sessionId: session.session_id,
      bank: session.aspsp.name,
      country: session.aspsp.country,
      validUntil: new Date(session.access.valid_until).toISOString(),
      status: "active" as const,
      lastError: null,
    }
    if (linkId === null) {
      const id = tx
        .insert(ebLinks)
        .values(values)
        .returning({ id: ebLinks.id })
        .get().id
      for (const a of usable)
        tx.insert(ebAccounts)
          .values({ linkId: id, ...accountValues(a) })
          .run()
      return { linkId: id, unmapped: usable.length > 0 }
    }
    tx.update(ebLinks).set(values).where(eq(ebLinks.id, linkId)).run()
    const existing = tx
      .select()
      .from(ebAccounts)
      .where(eq(ebAccounts.linkId, linkId))
      .all()
    const matches = matchAccounts(existing, usable)
    const kept = new Set(matches.values())
    // Park the matched rows' hashes first: a renewal can swap them between rows.
    for (const id of kept) {
      tx.update(ebAccounts)
        .set({ identificationHash: `renewing:${id}` })
        .where(eq(ebAccounts.id, id))
        .run()
    }
    let added = false
    for (const a of usable) {
      const id = matches.get(a)
      if (id === undefined) {
        tx.insert(ebAccounts)
          .values({ linkId, ...accountValues(a) })
          .run()
        added = true
        continue
      }
      const { uid, identificationHash, hashes: list } = accountValues(a)
      tx.update(ebAccounts)
        .set({ uid, identificationHash, hashes: list, nextAttemptAt: null })
        .where(eq(ebAccounts.id, id))
        .run()
      // The florin account follows the bank account's hash.
      const florinId = existing.find((e) => e.id === id)?.accountId
      if (florinId != null) {
        tx.update(accounts)
          .set({ externalId: identificationHash })
          .where(
            and(
              eq(accounts.id, florinId),
              eq(accounts.provider, "enablebanking")
            )
          )
          .run()
      }
    }
    // Bank accounts this access no longer covers stop syncing; their florin accounts keep everything.
    for (const e of existing.filter((x) => !kept.has(x.id))) {
      tx.delete(ebAccounts).where(eq(ebAccounts.id, e.id)).run()
      if (e.accountId !== null) {
        tx.update(accounts)
          .set({ provider: null, externalId: null })
          .where(eq(accounts.id, e.accountId))
          .run()
      }
    }
    return { linkId, unmapped: added }
  })
}

/**
 * Finishes an authorisation when the bank sends the browser back: checks the
 * state, makes the session and stores it. Answers where to send the browser:
 * the page it started from, with ?link=<id> when accounts need mapping or
 * ?linkError=<words> when it didn't work.
 */
export async function completeLink(
  params: URLSearchParams,
  psu?: PsuHeaders
): Promise<string> {
  const state = params.get("state") ?? ""
  const pending = state
    ? db().select().from(ebPending).where(eq(ebPending.state, state)).get()
    : undefined
  if (!pending || Date.parse(pending.createdAt) + PENDING_MS < Date.now()) {
    return withParams("/accounts", {
      linkError:
        "This bank link was started too long ago or somewhere else. Start it again.",
    })
  }
  db().delete(ebPending).where(eq(ebPending.state, state)).run()
  const back = (p: Record<string, string>) => withParams(pending.returnTo, p)
  const error = params.get("error")
  if (error) {
    const said = params.get("error_description")
    return back({
      linkError:
        error === "access_denied"
          ? "The bank link was cancelled."
          : `The bank didn't grant access${said ? `: ${said.slice(0, 200)}` : "."}`,
    })
  }
  const code = params.get("code")
  if (!code)
    return back({
      linkError: "The bank sent no authorisation code. Start again.",
    })
  let session: Session
  try {
    session = await api().createSession(code)
  } catch (e) {
    if (!(e instanceof EnableBankingError)) throw e
    return back({ linkError: e.message })
  }
  const renewing =
    pending.linkId !== null &&
    db().select().from(ebLinks).where(eq(ebLinks.id, pending.linkId)).get()
  // The old session is left to lapse, not deleted: banks that keep one
  // consent per person end the new session's access along with it (seen in
  // the Nordea sandbox).
  const { linkId, unmapped } = saveSession(
    session,
    renewing ? renewing.id : null
  )
  if (unmapped) return back({ link: String(linkId) })
  // A renewed link with every account still mapped syncs straight away.
  void syncLink(linkId, { psu }).catch(() => {})
  return back({ linked: String(linkId) })
}

/**
 * Sets which florin account each bank account of a link feeds ("new" makes
 * one, in the bank account's currency), then syncs the link. A new account
 * gets an opening balance so its balance matches the bank's.
 */
export async function mapAccounts(
  actor: Actor,
  linkId: number,
  mappings: AccountMapping[],
  psu?: PsuHeaders
): Promise<SyncResult> {
  const link = getLink(linkId)
  if (!Array.isArray(mappings))
    throw new InvalidInput("accounts must be a list")
  const rows = db()
    .select()
    .from(ebAccounts)
    .where(eq(ebAccounts.linkId, linkId))
    .all()
  const plan = mappings.map((m) => {
    const row = rows.find((r) => r.id === m?.bankAccountId)
    if (!row)
      throw new InvalidInput(
        `bank account ${m?.bankAccountId} isn't part of this link`
      )
    if (m.accountId !== null && m.accountId !== "new") {
      const account = getAccount(Number(m.accountId))
      if (!row.currency)
        throw new InvalidInput(
          `The bank doesn't say which currency ${row.name} is in.`
        )
      if (account.currency !== row.currency) {
        throw new InvalidInput(
          `${account.name} is in ${account.currency}, but ${row.name} is in ${row.currency}.`
        )
      }
      if (account.provider === "ibkr")
        throw new InvalidInput(
          `${account.name} is an Interactive Brokers account.`
        )
      const other = db()
        .select({ id: ebAccounts.id })
        .from(ebAccounts)
        .where(eq(ebAccounts.accountId, account.id))
        .get()
      if (
        other &&
        other.id !== row.id &&
        !mappings.some(
          (n) => n.bankAccountId === other.id && n.accountId !== account.id
        )
      ) {
        throw new InvalidInput(
          `${account.name} already gets another bank account's transactions.`
        )
      }
    }
    if (m.accountId === "new" && !row.currency) {
      throw new InvalidInput(
        `The bank doesn't say which currency ${row.name} is in, so florin can't make an account for it.`
      )
    }
    return { row, target: m.accountId }
  })
  // Unlink what changes first, so no two bank accounts hold one florin account at any point.
  for (const { row, target } of plan) {
    if (row.accountId !== null && row.accountId !== target) {
      db()
        .update(ebAccounts)
        .set({ accountId: null })
        .where(eq(ebAccounts.id, row.id))
        .run()
      const current = listAccounts().find((a) => a.id === row.accountId)
      if (current?.provider === "enablebanking")
        linkAccount(actor, current.id, { provider: null, externalId: null })
    }
  }
  for (const { row, target } of plan) {
    if (target === null || target === row.accountId) continue
    let accountId: number
    let fresh = false
    if (target === "new") {
      const last4 = row.identifier.replace(/\D/g, "").slice(-4)
      accountId = createAccount(actor, {
        name: last4 ? `${link.bank} ··${last4}` : `${link.bank} ${row.name}`,
        type: kindToType(row.kind),
        currency: row.currency,
      }).id
      fresh = true
    } else accountId = Number(target)
    // A florin account that carried this bank account under an earlier link lets it go.
    const holder = listAccounts().find(
      (a) =>
        a.provider === "enablebanking" &&
        a.externalId === row.identificationHash &&
        a.id !== accountId
    )
    if (holder)
      linkAccount(actor, holder.id, { provider: null, externalId: null })
    linkAccount(actor, accountId, {
      provider: "enablebanking",
      externalId: row.identificationHash,
    })
    db()
      .update(ebAccounts)
      .set({
        accountId,
        setOpening: fresh,
        lastSyncedAt: null,
        lastBookedDate: null,
      })
      .where(eq(ebAccounts.id, row.id))
      .run()
  }
  return syncLink(linkId, { psu })
}

/** Ends a link: closes the session at Enable Banking; the florin accounts keep their transactions. */
export async function disconnectLink(
  actor: Actor,
  linkId: number
): Promise<void> {
  const link = getLink(linkId)
  try {
    await api().deleteSession(link.sessionId)
  } catch (error) {
    // An expired or closed session, or missing credentials, is gone already as far as florin cares.
    if (!(error instanceof EnableBankingError)) throw error
  }
  const rows = db()
    .select()
    .from(ebAccounts)
    .where(eq(ebAccounts.linkId, linkId))
    .all()
  for (const r of rows) {
    if (r.accountId === null) continue
    const account = listAccounts().find((a) => a.id === r.accountId)
    if (account?.provider === "enablebanking")
      linkAccount(actor, account.id, { provider: null, externalId: null })
  }
  db().delete(ebLinks).where(eq(ebLinks.id, linkId)).run()
}

/** The person's PSU headers from their request, so a sync they start counts as them being present. */
export function psuHeaders(request: Request): PsuHeaders {
  const h = request.headers
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    "127.0.0.1"
  const out: PsuHeaders = { "psu-ip-address": ip }
  const ua = h.get("user-agent")
  if (ua) out["psu-user-agent"] = ua
  const lang = h.get("accept-language")
  if (lang) out["psu-accept-language"] = lang
  return out
}
