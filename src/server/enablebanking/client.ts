// The Enable Banking API client: a short-lived RS256 JWT signed with the
// application's private key on every call, and errors sorted into the few
// kinds florin acts on. Error messages are Enable Banking's own words or
// florin's; they never carry the key, the JWT or account data.
import { createPrivateKey, createSign } from "node:crypto"

export const API_URL = "https://api.enablebanking.com"

/** The API's address; FLORIN_ENABLE_BANKING_API points tests at a fake. */
export function apiUrl(): string {
  return process.env.FLORIN_ENABLE_BANKING_API || API_URL
}

export type Credentials = { appId: string; privateKey: string }

/**
 * What went wrong, as florin acts on it:
 * - `consent`: access to the bank ended (expired, revoked, closed) or the
 *   bank needs the person; only a renewal helps.
 * - `rate-limit`: the bank's limit on unattended fetches; try again later.
 * - `credentials`: the application id or key is wrong, or the clock is off.
 * - `bank`: the bank or Enable Banking failed; worth retrying later.
 * - `request`: florin asked for something the API refused.
 */
export type ErrorKind =
  "consent" | "rate-limit" | "credentials" | "bank" | "request"

export class EnableBankingError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
    /** Enable Banking's error code, e.g. "EXPIRED_SESSION". */
    readonly code: string | null = null,
    readonly status = 0
  ) {
    super(message)
  }
}

const CONSENT: Record<string, string> = {
  EXPIRED_SESSION: "Access to the bank has expired. Renew it to keep syncing.",
  REVOKED_SESSION: "Access to the bank was revoked. Renew it to keep syncing.",
  CLOSED_SESSION: "Access to the bank was closed. Renew it to keep syncing.",
  ASPSP_PSU_ACTION_REQUIRED:
    "The bank needs you to sign in again. Renew access to keep syncing.",
}

/** Sorts an error answer into an EnableBankingError with a plain message. */
export function toError(status: number, body: unknown): EnableBankingError {
  const b = (body && typeof body === "object" ? body : {}) as {
    error?: string
    message?: string
    detail?: unknown
  }
  const code = typeof b.error === "string" ? b.error : null
  const said = typeof b.message === "string" ? b.message : ""
  if (code && CONSENT[code])
    return new EnableBankingError(CONSENT[code], "consent", code, status)
  if (code === "ASPSP_RATE_LIMIT_EXCEEDED" || status === 429) {
    return new EnableBankingError(
      "The bank's limit on background fetches was reached; florin tries again at the next sync.",
      "rate-limit",
      code,
      status
    )
  }
  // JWT and application problems come without an error code.
  if (!code && (status === 401 || status === 403)) {
    const why =
      said === "Application does not exist"
        ? "Enable Banking doesn't know this application id."
        : /signature|key|decode|jwt/i.test(said) && !/expir|future/i.test(said)
          ? "Enable Banking refused the private key: it doesn't belong to this application."
          : /expir|future/i.test(said)
            ? "Enable Banking refused the request because this computer's clock is off."
            : `Enable Banking refused the application id or key${said ? ` (${said})` : ""}.`
    return new EnableBankingError(why, "credentials", null, status)
  }
  if (code === "ASPSP_ERROR" || code === "ASPSP_TIMEOUT" || status >= 500) {
    return new EnableBankingError(
      "The bank didn't answer properly; florin tries again at the next sync.",
      "bank",
      code,
      status
    )
  }
  if (code === "REDIRECT_URI_NOT_ALLOWED") {
    return new EnableBankingError(
      "The redirect URL isn't registered on the Enable Banking application.",
      "request",
      code,
      status
    )
  }
  return new EnableBankingError(
    said ? `Enable Banking: ${said}` : `Enable Banking answered ${status}`,
    "request",
    code,
    status
  )
}

/** Refuses anything but an RSA private key in PEM form, without echoing it. */
export function checkPrivateKey(pem: string): void {
  let key
  try {
    key = createPrivateKey(pem)
  } catch {
    throw new EnableBankingError(
      "That isn't a private key in PEM form (the .pem file Enable Banking gave you).",
      "credentials"
    )
  }
  if (key.asymmetricKeyType !== "rsa") {
    throw new EnableBankingError(
      "The private key must be an RSA key.",
      "credentials"
    )
  }
}

const b64url = (v: unknown) =>
  Buffer.from(JSON.stringify(v)).toString("base64url")

/** A JWT for the API, valid for `ttl` seconds (at most a day). */
export function jwt({ appId, privateKey }: Credentials, ttl = 3600): string {
  const iat = Math.floor(Date.now() / 1000) - 60 // a little early, for clock skew
  const input = `${b64url({ typ: "JWT", alg: "RS256", kid: appId })}.${b64url({
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat,
    exp: iat + ttl,
  })}`
  const sig = createSign("RSA-SHA256")
    .update(input)
    .sign(privateKey)
    .toString("base64url")
  return `${input}.${sig}`
}

/** Headers that mark a fetch as made while the person is present (exempt from the unattended limit). */
export type PsuHeaders = Record<string, string>

export type Client = ReturnType<typeof client>

/** The API calls florin makes, with these credentials. */
export function client(credentials: Credentials) {
  async function call<T>(
    method: string,
    path: string,
    options: {
      body?: unknown
      query?: Record<string, string | undefined>
      psu?: PsuHeaders
    } = {}
  ): Promise<T> {
    const url = new URL(path, apiUrl())
    for (const [k, v] of Object.entries(options.query ?? {}))
      if (v !== undefined) url.searchParams.set(k, v)
    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${jwt(credentials)}`,
          accept: "application/json",
          ...(options.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...options.psu,
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(60_000),
      })
    } catch {
      throw new EnableBankingError(
        "Couldn't reach Enable Banking; florin tries again at the next sync.",
        "bank"
      )
    }
    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }
    if (!response.ok) {
      const error = toError(response.status, parsed)
      const requestId = response.headers.get("x-request-id")
      console.error(
        `florin: Enable Banking ${method} ${path.split("/")[1]} → ${response.status} ${error.code ?? ""}${requestId ? ` (request ${requestId})` : ""}`
      )
      throw error
    }
    return parsed as T
  }

  return {
    application: () => call<Application>("GET", "/application"),
    banks: (country: string) =>
      call<{ aspsps: Aspsp[] }>("GET", "/aspsps", {
        query: { country, psu_type: "personal", service: "AIS" },
      }).then((r) => r.aspsps),
    startAuth: (body: {
      access: { valid_until: string }
      aspsp: { name: string; country: string }
      state: string
      redirect_url: string
      psu_type: "personal"
      language?: string
    }) =>
      call<{ url: string; authorization_id: string }>("POST", "/auth", {
        body,
      }),
    createSession: (code: string) =>
      call<Session>("POST", "/sessions", { body: { code } }),
    deleteSession: (id: string) =>
      call<unknown>("DELETE", `/sessions/${encodeURIComponent(id)}`),
    balances: (uid: string, psu?: PsuHeaders) =>
      call<{ balances: Balance[] }>(
        "GET",
        `/accounts/${encodeURIComponent(uid)}/balances`,
        { psu }
      ).then((r) => r.balances),
    transactions: (
      uid: string,
      query: {
        date_from?: string
        strategy?: "longest"
        continuation_key?: string
      },
      psu?: PsuHeaders
    ) =>
      call<{
        transactions: BankTransaction[]
        continuation_key?: string | null
      }>("GET", `/accounts/${encodeURIComponent(uid)}/transactions`, {
        query,
        psu,
      }),
  }
}

// The parts of Enable Banking's answers florin reads.

export type Application = {
  name: string
  kid: string
  environment: "SANDBOX" | "PRODUCTION"
  redirect_urls: string[]
  active: boolean
  countries: string[]
}

export type Aspsp = {
  name: string
  country: string
  logo?: string | null
  maximum_consent_validity?: number
  beta?: boolean
}

export type SessionAccount = {
  uid?: string | null
  identification_hash: string
  identification_hashes?: string[]
  account_id?: {
    iban?: string | null
    other?: { identification?: string; scheme_name?: string } | null
  } | null
  name?: string | null
  details?: string | null
  product?: string | null
  cash_account_type?: string | null
  currency?: string | null
}

export type Session = {
  session_id: string
  aspsp: { name: string; country: string }
  access: { valid_until: string }
  accounts: SessionAccount[]
}

export type Balance = {
  balance_amount: { currency: string; amount: string }
  balance_type: string
  reference_date?: string | null
}

export type Party = { name?: string | null } | null

export type BankTransaction = {
  entry_reference?: string | null
  transaction_amount: { currency: string; amount: string }
  creditor?: Party
  debtor?: Party
  credit_debit_indicator: "CRDT" | "DBIT"
  status: string
  booking_date?: string | null
  value_date?: string | null
  transaction_date?: string | null
  remittance_information?: string[] | null
}
