import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { useTempHome } from "./setup"
import { closeDatabase } from "@/server/db"
import {
  BOOT_DELAY_MS,
  SOON_MS,
  getJob,
  listJobs,
  registerJob,
  resetJobs,
  runJobNow,
  runJobSoon,
  startJobs,
  stopJobs,
} from "@/server/jobs"

useTempHome()

const HOUR = 60 * 60 * 1000
let n = 0

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-12T10:00:00Z") })
})
afterEach(() => {
  resetJobs()
  vi.useRealTimers()
})

/** A fresh job name per test, since job state outlives a test in the database. */
function name() {
  return `job-${++n}`
}

/** A job whose runs stay open until `finish()` is called. */
function slowJob() {
  let finish = () => {}
  const run = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  return { run, finish: () => finish() }
}

describe("scheduler", () => {
  test("a job that has never run runs shortly after boot, then every interval", async () => {
    const job = name()
    const run = vi.fn()
    registerJob({ name: job, everyMs: HOUR, run })
    startJobs()

    await vi.advanceTimersByTimeAsync(BOOT_DELAY_MS - 1)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
    expect(getJob(job)).toMatchObject({
      running: false,
      lastStartedAt: "2026-11-12T10:00:05.000Z",
      lastSuccessAt: "2026-11-12T10:00:05.000Z",
      lastError: null,
      nextDueAt: "2026-11-12T11:00:05.000Z",
    })

    await vi.advanceTimersByTimeAsync(HOUR - 1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
    expect(listJobs().map((j) => j.name)).toEqual([job])
  })

  test("a job never overlaps itself", async () => {
    const job = name()
    const { run, finish } = slowJob()
    registerJob({ name: job, everyMs: 1000, run })
    startJobs()

    await vi.advanceTimersByTimeAsync(BOOT_DELAY_MS)
    expect(run).toHaveBeenCalledTimes(1)
    expect(getJob(job).running).toBe(true)

    // Its interval passes and someone asks for a run: still the one run.
    await vi.advanceTimersByTimeAsync(10_000)
    const asked = runJobNow(job)
    expect(run).toHaveBeenCalledTimes(1)

    finish()
    const status = await asked
    expect(status).toMatchObject({ running: false, lastError: null })
    expect(run).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  test("a failure is recorded and retried at the next interval, not straight away", async () => {
    const job = name()
    const run = vi.fn((): void => {
      throw new Error("the bank said no")
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    registerJob({ name: job, everyMs: HOUR, run })
    startJobs()

    await vi.advanceTimersByTimeAsync(BOOT_DELAY_MS)
    expect(run).toHaveBeenCalledTimes(1)
    expect(getJob(job)).toMatchObject({
      lastError: "the bank said no",
      lastSuccessAt: null,
      nextDueAt: "2026-11-12T11:00:05.000Z",
    })

    await vi.advanceTimersByTimeAsync(HOUR - 1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)

    // A success clears the error.
    run.mockImplementation(() => {})
    await runJobNow(job)
    expect(getJob(job).lastError).toBeNull()
  })

  test("its state survives a restart: not due yet waits, overdue runs after boot", async () => {
    const job = name()
    const run = vi.fn()
    registerJob({ name: job, everyMs: HOUR, run })
    await runJobNow(job) // due again at 11:00
    expect(run).toHaveBeenCalledTimes(1)

    // Restart at 10:30: a new process with the same database.
    resetJobs()
    closeDatabase()
    vi.setSystemTime(new Date("2026-11-12T10:30:00Z"))
    registerJob({ name: job, everyMs: HOUR, run })
    startJobs()
    await vi.advanceTimersByTimeAsync(BOOT_DELAY_MS)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 - BOOT_DELAY_MS)
    expect(run).toHaveBeenCalledTimes(2)

    // Down for a day, then back: overdue, so it runs shortly after boot.
    stopJobs()
    resetJobs()
    closeDatabase()
    vi.setSystemTime(new Date("2026-11-13T12:00:00Z"))
    registerJob({ name: job, everyMs: HOUR, run })
    startJobs()
    await vi.advanceTimersByTimeAsync(BOOT_DELAY_MS - 1)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(3)
    expect(getJob(job).nextDueAt).toBe("2026-11-13T13:00:05.000Z")
  })

  test("runJobSoon runs a job in a moment, or once more after a run in progress", async () => {
    const job = name()
    const { run, finish } = slowJob()
    registerJob({ name: job, everyMs: HOUR, run })

    runJobSoon(job) // not started (tests, the CLI): nothing happens
    await vi.advanceTimersByTimeAsync(SOON_MS)
    expect(run).not.toHaveBeenCalled()

    startJobs()
    await vi.advanceTimersByTimeAsync(BOOT_DELAY_MS)
    expect(run).toHaveBeenCalledTimes(1)
    runJobSoon(job)
    finish()
    await vi.advanceTimersByTimeAsync(SOON_MS)
    expect(run).toHaveBeenCalledTimes(2)
    finish()
    await vi.advanceTimersByTimeAsync(SOON_MS)
    expect(run).toHaveBeenCalledTimes(2)

    runJobSoon(job)
    await vi.advanceTimersByTimeAsync(SOON_MS)
    expect(run).toHaveBeenCalledTimes(3)
    finish()
  })

  test("an unknown job is not found", async () => {
    await expect(runJobNow("nope")).rejects.toThrow("no job named nope")
  })
})
