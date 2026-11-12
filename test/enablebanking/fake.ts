// A fake Enable Banking API for tests, shaped after recorded sandbox answers
// (test/fixtures/enablebanking/): it checks the JWT the way the real one does,
// hands out sessions with fresh account uids each time, pages transactions
// and has knobs for what the sandbox can't do (pending rows, rate limits,
// revoked sessions).
import { createServer } from "node:http"
import { createVerify, generateKeyPairSync, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import type { IncomingHttpHeaders, ServerResponse } from "node:http"
import type { BankTransaction } from "@/server/enablebanking/client"

export const fixture = <T = unknown>(name: string): T =>
  JSON.parse(
    readFileSync(
      new URL(`../fixtures/enablebanking/${name}.json`, import.meta.url),
      "utf8"
    )
  ) as T

type FakeAccount = {
  hash: string
  hashes: string[]
  iban?: string
  card?: string
  kind: string
  product: string
  currency: string
  balances: { type: string; amount: string }[]
  transactions: BankTransaction[]
}

type Answer = { status: number; body: unknown }

export type FakeRequest = {
  method: string
  path: string
  query: URLSearchParams
  headers: IncomingHttpHeaders
}

export async function startFakeEnableBanking() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  })
  const appId = randomUUID()
  const state = {
    appId,
    privateKey,
    redirectUrls: [] as string[],
    pageSize: 2,
    banks: fixture<{ aspsps: unknown[] }>("aspsps-fi").aspsps,
    /** Bank accounts by identification hash; every session sees all of them. */
    accounts: new Map<string, FakeAccount>(),
    auths: new Map<
      string,
      { state: string; bank: string; validUntil: string }
    >(),
    codes: new Map<string, { bank: string; validUntil: string }>(),
    sessions: new Map<
      string,
      { uids: Map<string, string>; status: "AUTHORIZED" | "CLOSED" }
    >(),
    requests: [] as FakeRequest[],
    /** Answers to give instead, by "METHOD /first-path-part", used once each. */
    failNext: new Map<string, Answer[]>(),
  }

  const send = (res: ServerResponse, a: Answer) => {
    res.writeHead(a.status, { "content-type": "application/json" })
    res.end(JSON.stringify(a.body))
  }
  const error = (status: number, code: string | null, message: string) => ({
    status,
    body: code
      ? { code: status, message, error: code, detail: null }
      : { code: status, message },
  })

  function checkJwt(header: string | undefined): Answer | null {
    const token = header?.replace(/^Bearer /, "") ?? ""
    const [h, c, s] = token.split(".")
    if (!h || !c || !s) return error(401, null, "Invalid JWT")
    const head = JSON.parse(Buffer.from(h, "base64url").toString()) as {
      alg: string
      kid: string
    }
    const claims = JSON.parse(Buffer.from(c, "base64url").toString()) as {
      iss: string
      aud: string
      iat: number
      exp: number
    }
    if (head.kid !== state.appId)
      return error(403, null, "Application does not exist")
    const ok = createVerify("RSA-SHA256")
      .update(`${h}.${c}`)
      .verify(publicKey, Buffer.from(s, "base64url"))
    if (!ok || head.alg !== "RS256")
      return error(401, null, "JWT signature verification failed")
    const now = Date.now() / 1000
    if (claims.exp - claims.iat > 86400)
      return error(
        401,
        null,
        "JWT expiration time can not be more than 86400 seconds ahead"
      )
    if (claims.exp < now) return error(401, null, "JWT has expired")
    if (claims.iat > now + 60)
      return error(401, null, "JWT can not be issued in the future")
    if (
      claims.iss !== "enablebanking.com" ||
      claims.aud !== "api.enablebanking.com"
    )
      return error(401, null, "Invalid JWT claims")
    return null
  }

  function accountByUid(uid: string) {
    for (const [id, session] of state.sessions) {
      const hash = session.uids.get(uid)
      if (hash)
        return { sessionId: id, session, account: state.accounts.get(hash)! }
    }
    return null
  }

  function route(
    method: string,
    path: string,
    query: URLSearchParams,
    body: Record<string, unknown>
  ): Answer {
    const parts = path.split("/").filter(Boolean)
    if (method === "GET" && path === "/application") {
      return {
        status: 200,
        body: {
          ...fixture<object>("application"),
          kid: state.appId,
          redirect_urls: state.redirectUrls,
        },
      }
    }
    if (method === "GET" && path === "/aspsps") {
      return {
        status: 200,
        body: {
          aspsps: state.banks.filter(
            (b) => (b as { country: string }).country === query.get("country")
          ),
        },
      }
    }
    if (method === "POST" && path === "/auth") {
      const aspsp = body.aspsp as { name: string; country: string }
      if (!state.redirectUrls.includes(body.redirect_url as string))
        return error(
          400,
          "REDIRECT_URI_NOT_ALLOWED",
          "Redirect URI not allowed"
        )
      if (!state.banks.some((b) => (b as { name: string }).name === aspsp.name))
        return error(422, "WRONG_ASPSP_PROVIDED", "Wrong ASPSP name provided")
      const validUntil = (body.access as { valid_until: string }).valid_until
      if (Date.parse(validUntil) > Date.now() + 15552000 * 1000)
        return error(
          422,
          "WRONG_REQUEST_PARAMETERS",
          "ASPSP does not support consent validity more than 15552000 seconds in the future"
        )
      const id = randomUUID()
      state.auths.set(id, {
        state: body.state as string,
        bank: aspsp.name,
        validUntil,
      })
      return {
        status: 200,
        body: {
          url: `https://tilisy-sandbox.example/ais/start?sessionid=${id}`,
          authorization_id: id,
        },
      }
    }
    if (method === "POST" && path === "/sessions") {
      const code = state.codes.get(body.code as string)
      if (!code)
        return error(
          422,
          "WRONG_AUTHORIZATION_CODE",
          "Wrong authorization code provided"
        )
      state.codes.delete(body.code as string)
      const sessionId = randomUUID()
      const uids = new Map<string, string>()
      // Like the sandbox, each session lists the accounts in another order.
      const list = [...state.accounts.values()]
      if (state.sessions.size % 2 === 1) list.reverse()
      const accounts = list.map((a) => {
        const uid = randomUUID()
        uids.set(uid, a.hash)
        return {
          account_id: a.iban
            ? { iban: a.iban, other: null }
            : {
                iban: null,
                other: { identification: a.card, scheme_name: "CPAN" },
              },
          name: "Aino Salo",
          details: null,
          product: a.product,
          cash_account_type: a.kind,
          currency: a.currency,
          uid,
          identification_hash: a.hash,
          identification_hashes: a.hashes,
        }
      })
      state.sessions.set(sessionId, { uids, status: "AUTHORIZED" })
      return {
        status: 200,
        body: {
          session_id: sessionId,
          aspsp: { name: code.bank, country: "FI" },
          psu_type: "personal",
          access: { valid_until: code.validUntil },
          accounts,
        },
      }
    }
    if (method === "DELETE" && parts[0] === "sessions") {
      const session = state.sessions.get(parts[1])
      if (!session)
        return error(
          404,
          "SESSION_DOES_NOT_EXIST",
          "No session found matching provided id"
        )
      if (session.status === "CLOSED")
        return error(400, "CLOSED_SESSION", "Session is closed")
      session.status = "CLOSED"
      return { status: 200, body: { message: "OK" } }
    }
    if (method === "GET" && parts[0] === "accounts") {
      const found = accountByUid(parts[1])
      if (!found)
        return error(
          404,
          "ACCOUNT_DOES_NOT_EXIST",
          "No account found matching provided id"
        )
      if (found.session.status === "CLOSED")
        return error(401, "CLOSED_SESSION", "Session is closed")
      const { account } = found
      if (parts[2] === "balances") {
        return {
          status: 200,
          body: {
            balances: account.balances.map((b) => ({
              name: b.type,
              balance_amount: { currency: account.currency, amount: b.amount },
              balance_type: b.type,
              reference_date: null,
            })),
          },
        }
      }
      if (parts[2] === "transactions") {
        const from =
          query.get("strategy") === "longest" ? "" : query.get("date_from")
        if (from === null)
          return {
            status: 200,
            body: { transactions: [], continuation_key: null },
          }
        const list = account.transactions
          .filter(
            (t) =>
              (t.booking_date ?? t.value_date ?? t.transaction_date ?? "") >=
              from
          )
          .sort((a, b) =>
            (b.booking_date ?? b.value_date ?? "").localeCompare(
              a.booking_date ?? a.value_date ?? ""
            )
          )
        const start = Number(query.get("continuation_key") ?? 0)
        const page = list.slice(start, start + state.pageSize)
        const next = start + state.pageSize
        return {
          status: 200,
          body: {
            transactions: page,
            continuation_key: next < list.length ? String(next) : null,
          },
        }
      }
    }
    return error(404, "NOT_FOUND", "Not found")
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake")
    let raw = ""
    req.on("data", (c: Buffer) => (raw += c.toString()))
    req.on("end", () => {
      state.requests.push({
        method: req.method!,
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
      })
      const jwtError = checkJwt(req.headers.authorization)
      if (jwtError) return send(res, jwtError)
      const key = `${req.method} /${url.pathname.split("/")[1]}`
      const queued = state.failNext.get(key)?.shift()
      if (queued) return send(res, queued)
      send(
        res,
        route(
          req.method!,
          url.pathname,
          url.searchParams,
          raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        )
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  return {
    url,
    state,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    addAccount(a: FakeAccount) {
      state.accounts.set(a.hash, a)
      return a
    },
    /** The person approves at the bank: answers the callback's query for an authorisation started with `url`. */
    approve(authUrl: string): URLSearchParams {
      const id = new URL(authUrl).searchParams.get("sessionid")!
      const auth = state.auths.get(id)!
      const code = randomUUID()
      state.codes.set(code, { bank: auth.bank, validUntil: auth.validUntil })
      return new URLSearchParams({ state: auth.state, code })
    },
    /** The person cancels at the bank. */
    cancel(authUrl: string): URLSearchParams {
      const id = new URL(authUrl).searchParams.get("sessionid")!
      return new URLSearchParams({
        state: state.auths.get(id)!.state,
        error: "access_denied",
        error_description: "Denied data sharing consent",
      })
    },
    failNext(key: string, answer: Answer) {
      state.failNext.set(key, [...(state.failNext.get(key) ?? []), answer])
    },
    requestsTo(prefix: string) {
      return state.requests.filter((r) => r.path.startsWith(prefix))
    },
  }
}

export type FakeEnableBanking = Awaited<
  ReturnType<typeof startFakeEnableBanking>
>
