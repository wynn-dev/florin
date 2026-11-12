import { createFileRoute } from "@tanstack/react-router"
import { ECB_JOB, fxStatus } from "@/server/ecb"
import { runJobNow } from "@/server/jobs"
import { respond } from "@/server/http"
import "@/server/job-list"

/** Fetches the ECB rates now and answers the new status (with any error in job.lastError). */
export const Route = createFileRoute("/api/fx/refresh")({
  server: {
    handlers: {
      POST: () =>
        respond(async () => {
          await runJobNow(ECB_JOB)
          return fxStatus()
        }),
    },
  },
})
