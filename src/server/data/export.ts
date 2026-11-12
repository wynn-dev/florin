// The two downloads in Settings › General › Export: every transaction as CSV,
// and a consistent copy of the whole database.
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { db } from "../db"
import { homeDir } from "../config"
import { minorDigits } from "./fx"
import { listAccounts } from "./accounts"
import { listTransactions } from "./transactions"

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** "-4210" cents in EUR → "-42.10": plain, for spreadsheets and other apps. */
function decimal(cents: number, currency: string): string {
  const digits = minorDigits(currency)
  const sign = cents < 0 ? "-" : ""
  const abs = Math.abs(cents)
  if (!digits) return `${sign}${abs}`
  const unit = 10 ** digits
  return `${sign}${Math.floor(abs / unit)}.${String(abs % unit).padStart(digits, "0")}`
}

/** Every transaction, oldest first, one row each with the account's currency. */
export function transactionsCsv(): string {
  const currency = new Map(listAccounts().map((a) => [a.id, a.currency]))
  const rows: string[][] = []
  for (let offset = 0; ; offset += 1000) {
    const page = listTransactions({ limit: 1000, offset })
    for (const t of page.items) {
      const cur = currency.get(t.accountId) ?? ""
      rows.push([
        t.date,
        t.accountName,
        t.transferAccountName
          ? `Transfer: ${t.transferAccountName}`
          : (t.payeeName ?? ""),
        t.categoryName ?? "",
        decimal(t.amount, cur),
        cur,
        t.notes,
        t.status,
        t.importedPayee ?? "",
      ])
    }
    if (offset + 1000 >= page.total) break
  }
  rows.reverse()
  const header = [
    "Date",
    "Account",
    "Payee",
    "Category",
    "Amount",
    "Currency",
    "Notes",
    "Status",
    "Bank description",
  ]
  return (
    [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"
  )
}

/**
 * A copy of florin.db made with VACUUM INTO: consistent even while florin
 * writes, and a complete SQLite file on its own (no WAL beside it). The copy
 * is made inside florin's own private folder and removed once read.
 */
export function databaseCopy(): Uint8Array<ArrayBuffer> {
  const dir = mkdtempSync(join(homeDir(), ".export-"))
  try {
    const file = join(dir, "florin.db")
    db().$client.prepare("VACUUM INTO ?").run(file)
    return new Uint8Array(readFileSync(file))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
