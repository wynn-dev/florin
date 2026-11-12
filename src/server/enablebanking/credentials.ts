// The Enable Banking application id and private key, kept with florin's other
// connector secrets (src/server/secrets.ts), and the application they open.
import { InvalidInput } from "../data/validate"
import { getSecret, secretInfo, setSecret } from "../secrets"
import { EnableBankingError, checkPrivateKey, client } from "./client"
import type { Application, Client, Credentials } from "./client"

export const APP_ID = "enablebanking.appId"
export const PRIVATE_KEY = "enablebanking.privateKey"

export function credentials(): Credentials | null {
  const appId = getSecret(APP_ID)
  const privateKey = getSecret(PRIVATE_KEY)
  return appId && privateKey ? { appId, privateKey } : null
}

/** A client with the stored credentials; refuses in plain words when they aren't set. */
export function api(): Client {
  const c = credentials()
  if (!c) {
    throw new EnableBankingError(
      "Add the Enable Banking application id and private key in Settings first.",
      "credentials"
    )
  }
  return client(c)
}

export function credentialsInfo() {
  return { appId: secretInfo(APP_ID), privateKey: secretInfo(PRIVATE_KEY) }
}

// GET /application, kept a few minutes so the settings page doesn't ask on every load.
let cached:
  | { key: string; at: number; result: Application | EnableBankingError }
  | undefined
const CACHE_MS = 5 * 60_000

/** The application the stored credentials open, or the error that stopped it; null when not set. */
export async function application(): Promise<
  Application | EnableBankingError | null
> {
  const c = credentials()
  if (!c) return null
  const key = `${secretInfo(APP_ID).setAt}|${secretInfo(PRIVATE_KEY).setAt}`
  if (cached?.key === key && Date.now() - cached.at < CACHE_MS)
    return cached.result
  let result: Application | EnableBankingError
  try {
    result = await client(c).application()
  } catch (error) {
    if (!(error instanceof EnableBankingError)) throw error
    result = error
  }
  cached = { key, at: Date.now(), result }
  return result
}

/**
 * Saves a new application id and/or private key once GET /application
 * accepts them together with whatever is already stored. Nothing is saved
 * when they don't work; the error says what is wrong.
 */
export async function setCredentials(input: {
  appId?: unknown
  privateKey?: unknown
}): Promise<void> {
  if (input.appId === undefined && input.privateKey === undefined) {
    throw new InvalidInput("give an application id, a private key or both")
  }
  if (
    input.appId !== undefined &&
    (typeof input.appId !== "string" || !input.appId.trim())
  ) {
    throw new InvalidInput("The application id is empty.")
  }
  if (
    input.privateKey !== undefined &&
    (typeof input.privateKey !== "string" || !input.privateKey.trim())
  ) {
    throw new InvalidInput("The private key is empty.")
  }
  const appId = input.appId?.trim() ?? getSecret(APP_ID)
  const privateKey =
    input.privateKey !== undefined
      ? input.privateKey.trim() + "\n"
      : getSecret(PRIVATE_KEY)
  try {
    if (input.privateKey !== undefined) checkPrivateKey(privateKey!)
    if (appId && privateKey) await client({ appId, privateKey }).application()
  } catch (error) {
    if (!(error instanceof EnableBankingError)) throw error
    throw new InvalidInput(
      error.kind === "bank"
        ? "Couldn't reach Enable Banking to check them. Try again in a moment."
        : error.message
    )
  }
  if (input.appId !== undefined) setSecret(APP_ID, appId!)
  if (input.privateKey !== undefined) setSecret(PRIVATE_KEY, privateKey!)
  cached = undefined
}
