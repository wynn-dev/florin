// IBKR's Flex Web Service (v3): SendRequest with the token and query id
// answers a reference code, then GetStatement with that code answers the
// report once IBKR has generated it. Answers are told apart by their root
// element (FlexQueryResponse is the report, FlexStatementResponse a status
// with an ErrorCode), never by Status or the content type. Only "still
// generating" (1019) is waited for and asked again; every other error goes
// back to the caller, so a bad token is never retried into a block (1025).
// The token travels in the query string: request URLs are never logged.
import pkg from "../../../package.json"
import { IbkrError, flexError } from "./errors"
import { parseXml, rootName } from "./xml"

const BASE_URL =
  "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService"

/** The service's address; FLORIN_IBKR_FLEX_URL points florin at a fake one for tests and development. */
export function flexBaseUrl(): string {
  return (process.env.FLORIN_IBKR_FLEX_URL || BASE_URL).replace(/\/$/, "")
}

/** Waits before each GetStatement: 2 s, then 3, 5, 10, 20, then every 30 s, about 3 minutes in all. */
export const POLL_DELAYS_MS = [
  2_000, 3_000, 5_000, 10_000, 20_000, 30_000, 30_000, 30_000, 30_000, 30_000,
]

export type FlexRequest = {
  token: string
  queryId: string
  /** Days back from today (1–365) instead of the query's own period. */
  days?: number
}

export type FlexClientOptions = {
  sleep?: (ms: number) => Promise<void>
  fetch?: typeof fetch
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Asks IBKR for the report and returns its XML. Throws IbkrError in plain words. */
export async function fetchFlexReport(
  request: FlexRequest,
  options: FlexClientOptions = {}
): Promise<string> {
  const sleep = options.sleep ?? realSleep
  for (let attempt = 0; ; attempt++) {
    const reference = await sendRequest(request, options)
    try {
      return await getStatement(request.token, reference, sleep, options)
    } catch (error) {
      // An invalid reference code: start again from SendRequest, once.
      if (error instanceof IbkrError && error.code === 1017 && attempt === 0)
        continue
      throw error
    }
  }
}

async function sendRequest(
  { token, queryId, days }: FlexRequest,
  options: FlexClientOptions
): Promise<string> {
  const params: Record<string, string> = { t: token, q: queryId, v: "3" }
  if (days) params.p = String(Math.min(Math.max(Math.round(days), 1), 365))
  const xml = await call("SendRequest", params, options)
  const answer = statusAnswer(xml)
  if (answer.code) throw flexError(answer.code, answer.message)
  if (!answer.reference)
    throw new IbkrError(
      "IBKR's answer had no reference code. Try again later.",
      "retry"
    )
  return answer.reference
}

async function getStatement(
  token: string,
  reference: string,
  sleep: (ms: number) => Promise<void>,
  options: FlexClientOptions
): Promise<string> {
  for (const delay of POLL_DELAYS_MS) {
    await sleep(delay)
    const xml = await call(
      "GetStatement",
      { t: token, q: reference, v: "3" },
      options
    )
    const root = rootName(xml)
    if (root === "FlexQueryResponse") return xml
    if (root !== "FlexStatementResponse")
      throw new IbkrError(
        "IBKR answered with something that isn't a Flex report. Check that the query's format is XML.",
        "stop"
      )
    const answer = statusAnswer(xml)
    if (answer.code === 1019) continue
    throw flexError(answer.code ?? 0, answer.message)
  }
  throw new IbkrError(
    "IBKR is still preparing the report. Try again later.",
    "retry",
    1019
  )
}

async function call(
  endpoint: "SendRequest" | "GetStatement",
  params: Record<string, string>,
  options: FlexClientOptions
): Promise<string> {
  const url = `${flexBaseUrl()}/${endpoint}?${new URLSearchParams(params)}`
  let response: Response
  try {
    response = await (options.fetch ?? fetch)(url, {
      headers: { "User-Agent": `florin/${pkg.version}` },
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    throw new IbkrError(
      "florin couldn't reach IBKR. Check the internet connection and try again.",
      "retry"
    )
  }
  if (!response.ok)
    throw new IbkrError(
      `IBKR answered HTTP ${response.status}. Try again later.`,
      "retry"
    )
  return response.text()
}

type StatusAnswer = { code?: number; message: string; reference?: string }

/** Reads a FlexStatementResponse: its ErrorCode, ErrorMessage and ReferenceCode. */
function statusAnswer(xml: string): StatusAnswer {
  if (rootName(xml) !== "FlexStatementResponse")
    throw new IbkrError(
      "IBKR answered with something florin doesn't recognise. Try again later.",
      "retry"
    )
  let root
  try {
    root = parseXml(xml)
  } catch {
    throw new IbkrError("IBKR's answer was garbled. Try again later.", "retry")
  }
  const text = (name: string) =>
    root.children.find((c) => c.name.toLowerCase() === name.toLowerCase())
      ?.text ?? ""
  const code = Number(text("ErrorCode"))
  return {
    code: code > 0 ? code : undefined,
    message: text("ErrorMessage"),
    reference: text("ReferenceCode") || undefined,
  }
}
