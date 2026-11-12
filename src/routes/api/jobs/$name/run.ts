import { createFileRoute } from "@tanstack/react-router"
import { runJobNow } from "@/server/jobs"
import { respond } from "@/server/http"
import "@/server/job-list"

/** Runs a job now and answers its status once the run finishes. */
export const Route = createFileRoute("/api/jobs/$name/run")({
  server: {
    handlers: {
      POST: ({ params }) => respond(() => runJobNow(params.name)),
    },
  },
})
