import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll } from "vitest"
import { closeDatabase } from "@/server/db"

/** Points florin at a fresh data folder for the calling test file. */
export function useTempHome(): { dir: string } {
  const state = { dir: "" }
  beforeAll(() => {
    state.dir = mkdtempSync(
      join(process.env.TMPDIR || tmpdir(), "florin-test-")
    )
    process.env.FLORIN_HOME = state.dir
    closeDatabase()
  })
  afterAll(() => {
    closeDatabase()
    rmSync(state.dir, { recursive: true, force: true })
  })
  return state
}
