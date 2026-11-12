// Dashboard sign-in: one password, set on first run and kept as a scrypt hash
// in config.json, and a signed session cookie. Changing the password signs
// every session out.
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

export function setPassword(password: string): void {
  if (typeof password !== "string" || password.length < 8) {
    throw new InvalidInput("the password needs at least 8 characters")
  }
  saveConfig({ ...loadConfig(), passwordHash: hashPassword(password) })
}

function sign(expires: number): string {
  const config = loadConfig()
  return createHmac("sha256", config.sessionSecret)
    .update(`${expires}.${config.passwordHash ?? ""}`)
    .digest("base64url")
}

/** A new session token, valid for SESSION_DAYS. */
export function createSession(): string {
  const expires = Date.now() + SESSION_DAYS * 86_400_000
  return `${expires}.${sign(expires)}`
}

export function verifySession(token: string | undefined): boolean {
  if (!token || needsSetup()) return false
  const [expires, mac] = token.split(".")
  if (!(Number(expires) > Date.now()) || !mac) return false
  const expected = Buffer.from(sign(Number(expires)))
  const given = Buffer.from(mac)
  return expected.length === given.length && timingSafeEqual(expected, given)
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
