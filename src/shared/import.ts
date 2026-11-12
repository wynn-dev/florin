// CSV import as the dashboard's import dialog reads it before importing.
import type { CsvMapping } from "./types"

/** A CSV file read without importing it. */
export type CsvPreview = {
  headers: string[]
  /** The first 5 data rows, as cells. */
  sample: string[][]
  /** The mapping used: the one given, or florin's guess from the headers and values. */
  mapping: CsvMapping
  /** Data rows in the file. */
  rows: number
  /** Rows that would be added, and rows the account already has. Null while the mapping can't read the file. */
  added: number | null
  skipped: number | null
  /** Why the mapping can't read the file, e.g. 'cannot read date "31-13-2026"'. */
  error: string | null
}
