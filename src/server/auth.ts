// Dashboard sign-in: one password, kept as a scrypt hash in config.json, and a
// signed session cookie. The first password is set either from the first-run
// page, which asks for the setup code florin prints, or with `florin password`.
// Changing the password signs every session out.
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto"
import { loadConfig, saveConfig } from "./config"
import { InvalidInput } from "./data/validate"

export const SESSION_COOKIE = "florin_session"
export const SESSION_DAYS = 30

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 32).toString("hex")}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$")
  if (scheme !== "scrypt" || !salt || !hash) return false
  const actual = scryptSync(password, Buffer.from(salt, "hex"), 32)
  return timingSafeEqual(actual, Buffer.from(hash, "hex"))
}

export function needsSetup(): boolean {
  return !loadConfig().passwordHash
}

export function checkPassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length < 8) {
    throw new InvalidInput("the password needs at least 8 characters")
  }
}

/** Sets (or replaces) the dashboard password and drops the setup code. */
export function setPassword(password: string): void {
  checkPassword(password)
  const config = loadConfig()
  delete config.setupCode
  saveConfig({ ...config, passwordHash: hashPassword(password) })
}

/** Whether `code` is the current setup code (constant-time). */
export function checkSetupCode(code: unknown): boolean {
  const expected = loadConfig().setupCode
  if (!expected || typeof code !== "string") return false
  const a = createHmac("sha256", "florin-setup").update(expected).digest()
  const b = createHmac("sha256", "florin-setup")
    .update(code.trim().toUpperCase())
    .digest()
  return timingSafeEqual(a, b)
}

function sign(expires: number, nonce: string): string {
  const config = loadConfig()
  return createHmac("sha256", config.sessionSecret)
    .update(`${expires}.${nonce}.${config.passwordHash ?? ""}`)
    .digest("base64url")
}

/** A new session token, valid for SESSION_DAYS: "<expires>.<nonce>.<signature>". */
export function createSession(): string {
  const expires = Date.now() + SESSION_DAYS * 86_400_000
  const nonce = randomBytes(9).toString("base64url")
  return `${expires}.${nonce}.${sign(expires, nonce)}`
}

export function verifySession(token: string | undefined): boolean {
  if (!token || needsSetup()) return false
  const [expires, nonce, mac] = token.split(".")
  if (!(Number(expires) > Date.now()) || !nonce || !mac) return false
  if (loadConfig().signedOut?.[mac]) return false
  const expected = Buffer.from(sign(Number(expires), nonce))
  const given = Buffer.from(mac)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** Signs a session out for good: its token stops working before it expires. */
export function revokeSession(token: string | undefined): void {
  if (!verifySession(token)) return
  const [expires, , mac] = token!.split(".")
  const config = loadConfig()
  const now = Date.now()
  // Only tokens that haven't expired yet need remembering.
  const signedOut = Object.fromEntries(
    Object.entries(config.signedOut ?? {}).filter(([, until]) => until > now)
  )
  signedOut[mac] = Number(expires)
  saveConfig({ ...config, signedOut })
}

export function sessionFromRequest(request: Request): string | undefined {
  const cookies = request.headers.get("cookie") ?? ""
  for (const part of cookies.split(";")) {
    const [name, ...value] = part.trim().split("=")
    if (name === SESSION_COOKIE) return value.join("=")
  }
  return undefined
}

export function isSignedIn(request: Request): boolean {
  return verifySession(sessionFromRequest(request))
}

export function sessionCookie(
  token: string,
  maxAgeSeconds = SESSION_DAYS * 86_400
): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}
