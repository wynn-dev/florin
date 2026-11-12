// Starts the background jobs once the server boots (under `florin start` and
// `pnpm dev`; never during the build, the CLI's other commands or tests).
import { definePlugin } from "nitro"
import { startJobs, stopJobs } from "../jobs"
import "../job-list"

export default definePlugin((nitro) => {
  startJobs()
  nitro.hooks.hook("close", stopJobs)
})
