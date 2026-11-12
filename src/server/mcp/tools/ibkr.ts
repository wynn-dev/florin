import { InvalidInput } from "../../data/validate"
import { IbkrError, getIbkrStatus, pullIbkr } from "../../ibkr"
import { defineTool } from "../tool"
import type { IbkrStatus } from "@/shared/ibkr"

/** The status without what an agent has no use for (the token's details). */
function compact(status: IbkrStatus) {
  const { token, ...rest } = status
  return { tokenSet: token.set, ...rest }
}

export const ibkrStatus = defineTool({
  name: "ibkr_status",
  title: "Interactive Brokers status",
  description:
    "The IBKR Flex connection: whether a token and query id are set, the linked accounts (florin id, masked IBKR id, currency, latest value in minor units and its date), when IBKR generated the last report, the last error in plain words, when the next pull is allowed, and Flex query sections the report lacks. The token is set by the person in Settings, never over MCP.",
  input: {},
  kind: "read",
  run: () => compact(getIbkrStatus()),
})

export const ibkrPull = defineTool({
  name: "ibkr_pull",
  title: "Pull the IBKR report now",
  description:
    "Pulls the Interactive Brokers Flex report now and stores the accounts' values, holdings and new transactions (de-duplicated, so pulling again adds nothing twice). Takes up to a few minutes while IBKR prepares the report. IBKR allows one pull a minute; reports are end of day, so once a day is enough. Answers the status afterwards; an error says what the person must fix.",
  input: {},
  kind: "write",
  idempotent: true,
  run: async () => {
    try {
      return compact(await pullIbkr())
    } catch (error) {
      if (error instanceof IbkrError) throw new InvalidInput(error.message)
      throw error
    }
  },
})
