// API types for the Interactive Brokers connector (/api/connections/ibkr).
// florin pulls an Activity Flex report with the person's Flex token and query
// id; each IBKR account in it becomes a tracking-only investment account in
// the report's base currency. Times are ISO timestamps, UTC.

/** A Flex query section florin reads, by the name IBKR's query form uses. */
export type FlexSection =
  | "Account Information"
  | "Net Asset Value (NAV) in Base"
  | "Cash Report"
  | "Open Positions"
  | "Trades"
  | "Cash Transactions"

export type IbkrAccount = {
  /** The florin account's id. */
  id: number
  name: string
  /** IBKR's account id with all but the last four characters hidden: "U•••4716". */
  maskedId: string
  /** The account's base currency in IBKR, and so the florin account's. */
  currency: string
  /** Latest value (NAV total) in minor units of `currency`; null before the first report. */
  value: number | null
  /** The date of that value (IBKR reports end of day). */
  asOf: string | null
}

export type IbkrStatus = {
  /** Both a token and a query id are saved. */
  configured: boolean
  /** Whether a Flex token is saved and when; the token itself is never sent. */
  token: { set: boolean; setAt: string | null }
  queryId: string | null
  accounts: IbkrAccount[]
  /** When IBKR generated the newest report florin stored. */
  lastReportAt: string | null
  /** When the last pull (scheduled or by hand) finished, successful or not. */
  lastPullAt: string | null
  /** Why the last pull failed, in plain words; null after a successful one. */
  lastError: string | null
  /** A pull is in progress. */
  running: boolean
  /** When the next pull is allowed (IBKR limits requests); null means now. */
  nextPullAllowedAt: string | null
  /** Sections the last report lacked; tick them in the Flex query. */
  missingSections: FlexSection[]
}

/** PUT /api/connections/ibkr: a new token and/or query id, checked with a real pull before they are kept. */
export type IbkrCredentials = {
  /** Omit to keep the saved token (e.g. when only the query id changes). */
  token?: string
  queryId: string
}
