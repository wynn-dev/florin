// The Interactive Brokers connector: Flex Web Service client, report parser
// and sync. The /api/connections/ibkr routes and the MCP call these.
import { respond } from "../http"
import { IbkrError } from "./errors"
import { TooSoon } from "./sync"

export { IbkrError, MissingSectionError } from "./errors"
export {
  IBKR_JOB,
  TooSoon,
  connectIbkr,
  disconnectIbkr,
  getIbkrStatus,
  pullIbkr,
} from "./sync"

/** respond() for the IBKR routes: a refused pull is 429, a failed one 502 with its plain-words reason. */
export function respondIbkr(fn: () => unknown): Promise<Response> {
  return respond(async () => {
    try {
      return await fn()
    } catch (error) {
      if (error instanceof TooSoon)
        return Response.json(
          { error: error.message, allowedAt: error.allowedAt },
          { status: 429 }
        )
      if (error instanceof IbkrError)
        return Response.json({ error: error.message }, { status: 502 })
      throw error
    }
  })
}
