// A fake IBKR Flex Web Service for tests and development, serving the
// synthetic sample report. It behaves like the real one where florin cares:
// SendRequest checks the token, query id, v=3 and a User-Agent and answers a
// reference code; GetStatement answers "still generating" (1019) a set number
// of times, then the report. Canned answers can be queued per endpoint.
//
// Development: node test/ibkr/fake-flex.ts [port] [report.xml]
// then start florin with FLORIN_IBKR_FLEX_URL=http://127.0.0.1:<port>.
// It accepts the token 1234567890123456 and query id 123456.
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

export const FAKE_TOKEN = "1234567890123456"
export const FAKE_QUERY = "123456"

export type FakeFlex = {
  url: string
  /** Every request, with its parameters (the token replaced by "set"). */
  calls: {
    endpoint: string
    params: Record<string, string>
    userAgent?: string
  }[]
  /** Canned answers, used before anything else, in order. */
  queue: { SendRequest: string[]; GetStatement: string[] }
  /** How many 1019 answers GetStatement gives before the report. */
  generating: number
  report: string
  expiredToken?: string
  close: () => Promise<void>
}

const status = (body: string) =>
  `<FlexStatementResponse timestamp="12 November, 2026 03:15 AM EST">${body}</FlexStatementResponse>`

export function flexError(
  code: number,
  message: string,
  state = "Fail"
): string {
  return status(
    `<Status>${state}</Status><ErrorCode>${code}</ErrorCode><ErrorMessage>${message}</ErrorMessage>`
  )
}

export async function startFakeFlex(
  report: string,
  port = 0
): Promise<FakeFlex> {
  let reference = 7351902648
  const fake: FakeFlex = {
    url: "",
    calls: [],
    queue: { SendRequest: [], GetStatement: [] },
    generating: 1,
    report,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
  let pending = 0
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake")
    const endpoint = url.pathname.split("/").pop() ?? ""
    const params = Object.fromEntries(url.searchParams)
    fake.calls.push({
      endpoint,
      params: { ...params, ...(params.t ? { t: "set" } : {}) },
      userAgent: req.headers["user-agent"],
    })
    const send = (body: string) => {
      res.writeHead(200, { "content-type": "text/plain;charset=UTF-8" })
      res.end(body)
    }
    if (endpoint !== "SendRequest" && endpoint !== "GetStatement") {
      res.writeHead(404).end()
      return
    }
    const canned = fake.queue[endpoint].shift()
    if (canned) return send(canned)
    if (params.v !== "3" || !req.headers["user-agent"])
      return send(
        flexError(1020, "Invalid request or unable to validate request.")
      )
    if (endpoint === "SendRequest") {
      if (params.t === fake.expiredToken)
        return send(flexError(1012, "Token has expired."))
      if (params.t !== FAKE_TOKEN)
        return send(flexError(1015, "Token is invalid."))
      if (params.q !== FAKE_QUERY)
        return send(flexError(1014, "Query is invalid."))
      pending = fake.generating
      return send(
        status(
          `<Status>Success</Status><ReferenceCode>${++reference}</ReferenceCode><Url>https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url>`
        )
      )
    }
    if (params.q !== String(reference))
      return send(flexError(1017, "Reference code is invalid."))
    if (pending-- > 0)
      return send(
        flexError(
          1019,
          "Statement generation in progress. Please try again shortly.",
          "Warn"
        )
      )
    send(fake.report)
  })
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve)
  )
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return fake
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 4799)
  const file =
    process.argv[3] ??
    new URL("../fixtures/ibkr/flex-report.xml", import.meta.url)
  const fake = await startFakeFlex(readFileSync(file, "utf8"), port)
  console.log(
    `fake IBKR Flex on ${fake.url} (token ${FAKE_TOKEN}, query ${FAKE_QUERY})`
  )
}
