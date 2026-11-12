// Every background job florin runs, one line each (see src/server/jobs.ts).
import { registerJob } from "./jobs"
import { ECB_EVERY_MS, ECB_JOB, refreshRates } from "./ecb"
import { IBKR_EVERY_MS, IBKR_JOB, scheduledIbkrPull } from "./ibkr/sync"

registerJob({ name: ECB_JOB, everyMs: ECB_EVERY_MS, run: () => refreshRates() })
registerJob({
  name: IBKR_JOB,
  everyMs: IBKR_EVERY_MS,
  run: () => scheduledIbkrPull(),
})
