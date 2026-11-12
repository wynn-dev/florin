// API types for bank sync through Enable Banking (/api/connections/enable-banking).
// Times are ISO timestamps, UTC; amounts are minor units in the bank account's
// currency. Credentials are never part of any answer: only whether they are set.

export type SyncHours = 6 | 12 | 24

/** A link's state: `expiring` means access ends within EXPIRING_DAYS. */
export type LinkState = "active" | "expiring" | "expired" | "revoked"

/** How many days before access ends a link counts as expiring. */
export const EXPIRING_DAYS = 14

export type EnableBankingStatus = {
  appId: { set: boolean; setAt: string | null }
  privateKey: { set: boolean; setAt: string | null }
  /** The redirect URL to register on the Enable Banking application. */
  redirectUrl: string
  /** What GET /application says, once credentials are set and work. */
  application: {
    name: string
    environment: "SANDBOX" | "PRODUCTION"
    active: boolean
    /** Whether the application lists redirectUrl among its redirect URLs. */
    redirectRegistered: boolean
    /** Countries the application can link banks in (ISO 3166 alpha-2). */
    countries: string[]
  } | null
  /** Why the application couldn't be read, in plain words; null when it could (or nothing is set). */
  applicationError: string | null
  syncHours: SyncHours
  links: BankLink[]
}

export type BankLink = {
  id: number
  bank: string
  country: string
  state: LinkState
  /** When access ends. */
  validUntil: string
  /** Whole days until access ends; negative once it has. */
  daysLeft: number
  lastSyncAt: string | null
  /** The last sync's error in plain words; null after a sync that went fine. */
  lastError: string | null
  /** Whether a sync of this link is running now. */
  syncing: boolean
  accounts: BankAccount[]
}

export type BankAccount = {
  /** florin's id for this bank account (stable across renewals). */
  id: number
  /** The bank's name for the account (product or holder), e.g. "KÄYTTÖTILI". */
  name: string
  /** The IBAN or card number as the bank shows it, masked: "FI74 •••• 7469". */
  identifier: string
  currency: string
  /** "CACC" current, "CARD" card, "SVGS" savings, … as the bank says. */
  kind: string
  /** The florin account it feeds, or null while not linked. */
  accountId: number | null
  accountName: string | null
  /** A florin account that already carries this bank account (from an earlier link), to suggest. */
  suggestedAccountId: number | null
  lastSyncedAt: string | null
  /** No sync before this time (the bank's rate limit). */
  nextAttemptAt: string | null
  /** The balance the bank reports and when florin read it. */
  bankBalance: number | null
  bankBalanceAt: string | null
}

export type Bank = {
  name: string
  country: string
  logo: string | null
  /** The longest access the bank grants, in days. */
  maxAccessDays: number
  beta: boolean
}

export type SetCredentials = {
  /** Leave out to keep the one already set. */
  appId?: string
  /** The PEM text of the application's private key; leave out to keep the one already set. */
  privateKey?: string
}

export type StartLink = {
  country: string
  bank: string
  /** Where the browser lands after the bank, e.g. "/accounts" (a path on florin). */
  returnTo?: string
}

/** For one bank account of a link: a florin account id, "new" for a new account, or null to leave it out. */
export type AccountMapping = {
  bankAccountId: number
  accountId: number | "new" | null
}

export type SyncResult = {
  /** Transactions added across the link's accounts. */
  added: number
  /** Pending transactions that became booked, or changed. */
  updated: number
  /** Pending transactions the bank dropped. */
  removed: number
  /** Bank transactions attached to rows already in the account (typed in or from a CSV). */
  matched: number
  /** The error in plain words if the sync stopped early. */
  error: string | null
}
