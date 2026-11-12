// API types for background jobs (/api/jobs) and exchange rates (/api/fx).

/** A background job and how its runs went. Times are ISO timestamps, UTC. */
export type Job = {
  name: string
  everyMs: number
  running: boolean
  lastStartedAt: string | null
  lastSuccessAt: string | null
  /** The last run's error message; null once a run succeeds. */
  lastError: string | null
  nextDueAt: string | null
}

/** The ECB rates florin keeps for accounts outside the budget's currency. */
export type FxStatus = {
  /**
   * Each currency florin needs a rate for (every account currency other than
   * the budget's, plus the budget's when it isn't EUR) and the date of its
   * newest stored rate. Empty when every account is in the budget's currency.
   */
  currencies: { currency: string; latestDate: string | null }[]
  /** The rate refresh job ("ecb"). */
  job: Job
}
