// Background jobs: a plain in-process scheduler. Jobs are registered in
// src/server/job-list.ts and started once when the server boots
// (src/server/plugins/jobs.ts). Each job's last start, last success, last
// error and next due time live in the jobs table, so a restart picks up where
// it left off: a job that is overdue (or has never run) runs shortly after
// boot. A job never overlaps itself, and a failed run is retried at its next
// interval, never straight away.
import { eq } from "drizzle-orm"
import { db, schema } from "./db"
import { NotFound } from "./data/validate"
import type { Job } from "@/shared/jobs"

export type JobDefinition = {
  /** A short id, used in the API path: /api/jobs/<name>/run. */
  name: string
  everyMs: number
  run: () => unknown
}

/** How long after boot an overdue job waits, so the server is up first. */
export const BOOT_DELAY_MS = 5_000
/** How long after a nudge (runJobSoon) a job runs. */
export const SOON_MS = 2_000

// One registry per process, even if the server bundle loads this module twice.
const state = ((globalThis as { __florinJobs?: JobsState }).__florinJobs ??= {
  jobs: new Map(),
  running: new Map(),
  timers: new Map(),
  again: new Set(),
  started: false,
})

type JobsState = {
  jobs: Map<string, JobDefinition>
  running: Map<string, Promise<void>>
  timers: Map<string, ReturnType<typeof setTimeout>>
  /** Jobs nudged while running, to run once more when they finish. */
  again: Set<string>
  started: boolean
}

const { jobs: table } = schema

export function registerJob(job: JobDefinition): void {
  if (!(job.everyMs > 0))
    throw new Error(`job ${job.name}: everyMs must be > 0`)
  state.jobs.set(job.name, job)
  if (state.started) schedule(job.name, BOOT_DELAY_MS)
}

/** Starts the timers of every registered job. Called once at server boot. */
export function startJobs(): void {
  if (state.started) return
  state.started = true
  for (const name of state.jobs.keys()) schedule(name, BOOT_DELAY_MS)
}

/** Stops every timer (a run in progress finishes on its own). */
export function stopJobs(): void {
  for (const timer of state.timers.values()) clearTimeout(timer)
  state.timers.clear()
  state.started = false
}

/** Forgets every registered job; for tests. */
export function resetJobs(): void {
  stopJobs()
  state.jobs.clear()
  state.running.clear()
  state.again.clear()
}

function row(name: string) {
  return db().select().from(table).where(eq(table.name, name)).get()
}

function save(name: string, set: Partial<typeof table.$inferInsert>): void {
  db()
    .insert(table)
    .values({ name, ...set })
    .onConflictDoUpdate({ target: table.name, set })
    .run()
}

/** Sets the job's timer for its next due time, but no sooner than `minDelay`. */
function schedule(name: string, minDelay = 0): void {
  if (!state.started) return
  clearTimeout(state.timers.get(name))
  const due = row(name)?.nextDueAt
  const wait = due ? Date.parse(due) - Date.now() : 0
  // setTimeout can't wait longer than ~24.8 days; it simply re-checks then.
  setTimer(name, Math.min(Math.max(wait, minDelay), 2 ** 31 - 1), () => {
    const dueAt = row(name)?.nextDueAt
    if (dueAt && Date.parse(dueAt) > Date.now()) schedule(name)
    else void runJobNow(name).catch(() => {})
  })
}

function setTimer(name: string, delay: number, fn: () => void): void {
  clearTimeout(state.timers.get(name))
  const timer = setTimeout(() => {
    state.timers.delete(name)
    fn()
  }, delay)
  timer.unref?.()
  state.timers.set(name, timer)
}

/**
 * Runs a job now and resolves with its status once it finishes. If it is
 * already running, waits for that run instead of starting another.
 */
export async function runJobNow(name: string): Promise<Job> {
  const job = state.jobs.get(name)
  if (!job) throw new NotFound(`no job named ${name}`)
  let run = state.running.get(name)
  if (!run) {
    run = runOnce(job).finally(() => state.running.delete(name))
    state.running.set(name, run)
  }
  await run
  return getJob(name)
}

/**
 * Runs a job in a moment, e.g. after a change that gives it new work; if it
 * is running, once more after it finishes. Does nothing until the scheduler
 * has started (so not in tests or the CLI).
 */
export function runJobSoon(name: string): void {
  if (!state.started || !state.jobs.has(name)) return
  if (state.running.has(name)) state.again.add(name)
  else setTimer(name, SOON_MS, () => void runJobNow(name).catch(() => {}))
}

async function runOnce(job: JobDefinition): Promise<void> {
  clearTimeout(state.timers.get(job.name))
  save(job.name, { lastStartedAt: new Date().toISOString() })
  try {
    await job.run()
    save(job.name, {
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      nextDueAt: new Date(Date.now() + job.everyMs).toISOString(),
    })
  } catch (error) {
    const message =
      (error instanceof Error ? error.message : String(error)) || "failed"
    console.error(`florin: job ${job.name} failed: ${message}`)
    save(job.name, {
      lastError: message,
      nextDueAt: new Date(Date.now() + job.everyMs).toISOString(),
    })
  }
  if (state.again.delete(job.name)) {
    setTimer(job.name, SOON_MS, () => void runJobNow(job.name).catch(() => {}))
  } else schedule(job.name)
}

export function getJob(name: string): Job {
  const job = state.jobs.get(name)
  if (!job) throw new NotFound(`no job named ${name}`)
  const r = row(name)
  return {
    name,
    everyMs: job.everyMs,
    running: state.running.has(name),
    lastStartedAt: r?.lastStartedAt ?? null,
    lastSuccessAt: r?.lastSuccessAt ?? null,
    lastError: r?.lastError ?? null,
    nextDueAt: r?.nextDueAt ?? null,
  }
}

export function listJobs(): Job[] {
  return [...state.jobs.keys()].map(getJob)
}
