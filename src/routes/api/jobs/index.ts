import { createFileRoute } from "@tanstack/react-router"
import { listJobs } from "@/server/jobs"
import { respond } from "@/server/http"
import "@/server/job-list"

export const Route = createFileRoute("/api/jobs/")({
  server: {
    handlers: {
      GET: () => respond(listJobs),
    },
  },
})
