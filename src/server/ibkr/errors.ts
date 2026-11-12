// The IBKR connector's errors, each in plain words the dashboard can show as
// is. None of them ever carries the token, a request URL or report content.
import type { FlexSection } from "@/shared/ibkr"

export type IbkrErrorKind =
  /** The person must fix something (token, query, settings); never retried on its own. */
  | "stop"
  /** IBKR is busy or not ready; the next scheduled pull tries again. */
  | "retry"
  /** Too many requests: wait at least a minute. */
  | "throttled"
  /** Too many failed attempts: no automatic pulls until tomorrow. */
  | "blocked"

export class IbkrError extends Error {
  constructor(
    message: string,
    readonly kind: IbkrErrorKind,
    /** IBKR's Flex error code, when the answer had one. */
    readonly code?: number
  ) {
    super(message)
  }
}

/** The report can't be used as it is; the Flex query needs changing. */
export class FlexQueryError extends IbkrError {
  constructor(message: string) {
    super(message, "stop")
  }
}

export class MissingSectionError extends FlexQueryError {
  constructor(readonly section: FlexSection) {
    super(
      `The Flex query has no ${section} section. In IBKR, edit the Flex query, tick ${section}, and save.`
    )
  }
}

const NEW_TOKEN =
  "In IBKR Client Portal open Performance & Reports › Flex Queries › Flex Web Service Configuration, generate a new token, and paste it in florin."

/** IBKR's Flex Web Service error codes, as florin explains and handles them. */
export function flexError(code: number, ibkrMessage: string): IbkrError {
  switch (code) {
    case 1012:
      return new IbkrError(
        `Your IBKR Flex token has expired. ${NEW_TOKEN}`,
        "stop",
        code
      )
    case 1015:
      return new IbkrError(
        `IBKR doesn't accept this Flex token: it may be mistyped or replaced by a newer one. ${NEW_TOKEN}`,
        "stop",
        code
      )
    case 1014:
      return new IbkrError(
        "IBKR can't find this Flex query. Check the Query ID under Performance & Reports › Flex Queries (the number beside the query's name).",
        "stop",
        code
      )
    case 1010:
      return new IbkrError(
        "This is a legacy Flex query, which IBKR no longer serves. Create an Activity Flex Query instead.",
        "stop",
        code
      )
    case 1011:
      return new IbkrError(
        "The Flex Web Service is turned off for this IBKR account. Turn it on under Performance & Reports › Flex Queries › Flex Web Service Configuration.",
        "stop",
        code
      )
    case 1013:
      return new IbkrError(
        "This Flex token only works from certain IP addresses, and this machine isn't one of them. Generate a token without an IP restriction.",
        "stop",
        code
      )
    case 1016:
    case 1020:
      return new IbkrError(
        `IBKR refused the request: ${ibkrMessage}`,
        "stop",
        code
      )
    case 1018:
      return new IbkrError(
        "IBKR says too many requests were made with this token. Try again in a minute.",
        "throttled",
        code
      )
    case 1025:
      return new IbkrError(
        "IBKR blocked this token for today after too many failed attempts. florin won't try again until tomorrow.",
        "blocked",
        code
      )
    case 1005:
    case 1006:
    case 1007:
    case 1008:
      return new IbkrError(
        "IBKR is still processing yesterday's data. Try again in about an hour.",
        "retry",
        code
      )
    default:
      return new IbkrError(
        `IBKR couldn't produce the report right now (${ibkrMessage || `error ${code}`}). Try again later.`,
        "retry",
        code
      )
  }
}
