// Every background job florin runs, one line each (see src/server/jobs.ts).
import { registerJob } from "./jobs"
import { ECB_EVERY_MS, ECB_JOB, refreshRates } from "./ecb"

registerJob({ name: ECB_JOB, everyMs: ECB_EVERY_MS, run: () => refreshRates() })
