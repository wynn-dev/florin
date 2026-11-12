// The one path for bringing outside transactions in, used by CSV import and by
// the bank connector: rows carry the source's own id, and a row whose id the
// account already has is skipped.
import { createHash } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { db, schema } from "../db"
import { getAccount } from "./accounts"
import { logChange } from "./changes"
import { payeeIdForName } from "./payees"
import { getCategory } from "./categories"
import { minorDigits } from "./fx"
import {
  checkAmount,
  checkDate,
  checkList,
  checkObject,
  InvalidInput,
  NotFound,
} from "./validate"
import type { Actor, CsvMapping, ImportResult, ImportRow } from "@/shared/types"

const { transactions } = schema

/**
 * Adds rows to an account, skipping any whose importedId is already there.
 * Rows without an importedId get one derived from date, amount and payee
 * (with a counter for identical rows), so importing the same file twice adds
 * nothing the second time.
 */
export function importTransactions(
  actor: Actor,
  accountId: number,
  rows: ImportRow[]
): ImportResult {
  const account = getAccount(accountId)
  const seen = new Map<string, number>()
  const prepared = checkList(rows, "rows").map((row, i) => {
    checkObject(row, `row ${i + 1}`)
    if (row.categoryId !== undefined && row.categoryId !== null)
      checkImportCategory(row.categoryId, i)
    const date = checkDate(row.date, `row ${i + 1} date`)
    const amount = checkAmount(row.amount, `row ${i + 1} amount`)
    const payee = String(row.payee ?? "").trim()
    let importedId = row.importedId?.trim()
    if (!importedId) {
      const key = `${date}|${amount}|${payee.toLowerCase()}`
      const n = (seen.get(key) ?? 0) + 1
      seen.set(key, n)
      importedId =
        "row:" +
        createHash("sha256").update(`${key}|${n}`).digest("hex").slice(0, 24)
    }
    return { ...row, date, amount, payee, importedId }
  })

  return db().transaction((tx) => {
    const ids = prepared.map((r) => r.importedId)
    const existing = new Set<string>()
    for (let i = 0; i < ids.length; i += 500) {
      tx.select({ id: transactions.importedId })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, accountId),
            inArray(transactions.importedId, ids.slice(i, i + 500))
          )
        )
        .all()
        .forEach((r) => existing.add(r.id!))
    }
    let added = 0
    for (const row of prepared) {
      if (existing.has(row.importedId)) continue
      existing.add(row.importedId)
      tx.insert(transactions)
        .values({
          accountId,
          date: row.date,
          amount: row.amount,
          payeeId: row.payee ? payeeIdForName(cleanPayee(row.payee), tx) : null,
          categoryId: row.categoryId ?? null,
          notes: row.notes ?? "",
          status: row.status ?? "cleared",
          importedId: row.importedId,
          importedPayee: row.payee || null,
          bookedDate: row.bookedDate ?? null,
        })
        .run()
      added++
    }
    const skipped = prepared.length - added
    if (added) {
      logChange(tx, actor, {
        action: "create",
        entity: "transaction",
        summary:
          `Imported ${added} transactions into ${account.name}` +
          (skipped ? ` (${skipped} already there)` : ""),
      })
    }
    return { added, skipped }
  })
}

function checkImportCategory(categoryId: number, i: number) {
  try {
    getCategory(categoryId)
  } catch (error) {
    if (error instanceof NotFound)
      throw new InvalidInput(`row ${i + 1}: there is no category ${categoryId}`)
    throw error
  }
}

/** Bank descriptions often shout and pad; keep the payee name readable. */
function cleanPayee(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim()
  if (name !== name.toUpperCase()) return name
  return name.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

/** Parses CSV text (comma, semicolon or tab separated, quoted fields) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0]
  const sep = [",", ";", "\t"].reduce((best, s) =>
    firstLine.split(s).length > firstLine.split(best).length ? s : best
  )
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') ((cell += c), i++)
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === sep) (row.push(cell), (cell = ""))
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      ;(row.push(cell), rows.push(row), (row = []), (cell = ""))
    } else cell += c
  }
  if (cell || row.length) (row.push(cell), rows.push(row))
  return rows.filter((r) => r.some((v) => v.trim()))
}

function parseDate(
  value: string,
  format: CsvMapping["dateFormat"] = "YYYY-MM-DD"
): string {
  const parts = value.trim().split(/[-/.]/)
  if (parts.length !== 3) throw new InvalidInput(`cannot read date "${value}"`)
  const [y, m, d] =
    format === "YYYY-MM-DD"
      ? parts
      : format === "MM/DD/YYYY"
        ? [parts[2], parts[0], parts[1]]
        : [parts[2], parts[1], parts[0]]
  return checkDate(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`)
}

/** "1.234,56" or "-1,234.56" → minor units, with the currency's number of decimals. */
function parseMoney(
  value: string,
  digits: number,
  decimal: "." | "," = "."
): number {
  let v = value.trim().replace(/[^\d.,()-]/g, "")
  if (!v) return 0
  const negative = v.startsWith("-") || (v.startsWith("(") && v.endsWith(")"))
  v = v.replace(/[()-]/g, "")
  const [whole, frac = ""] = (
    decimal === "," ? v.replace(/\./g, "") : v.replace(/,/g, "")
  ).split(decimal)
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac))
    throw new InvalidInput(`cannot read amount "${value}"`)
  const minor =
    Number(whole || 0) * 10 ** digits +
    Number((frac + "0".repeat(digits)).slice(0, digits) || 0)
  return negative ? -minor : minor
}

/** Imports a CSV file into an account, mapping columns by their header names. */
export function importCsv(
  actor: Actor,
  accountId: number,
  csv: string,
  mapping: CsvMapping
): ImportResult {
  checkObject(mapping, "mapping")
  const digits = minorDigits(getAccount(accountId).currency)
  const [header, ...lines] = parseCsv(csv)
  if (!header) throw new InvalidInput("the file is empty")
  const col = (name: string | undefined) => {
    if (name === undefined) return -1
    const i = header.findIndex(
      (h) => h.trim().toLowerCase() === name.trim().toLowerCase()
    )
    if (i < 0) throw new InvalidInput(`no column named "${name}"`)
    return i
  }
  const date = col(mapping.date)
  const payee = col(mapping.payee)
  const notes = col(mapping.notes)
  const amount = col(mapping.amount)
  const inflow = col(mapping.inflow)
  const outflow = col(mapping.outflow)
  if (amount < 0 && inflow < 0 && outflow < 0)
    throw new InvalidInput("map an amount column, or inflow and outflow")
  const rows: ImportRow[] = lines.map((cells) => ({
    date: parseDate(cells[date] ?? "", mapping.dateFormat),
    amount:
      amount >= 0
        ? parseMoney(cells[amount] ?? "", digits, mapping.decimal)
        : parseMoney(cells[inflow] ?? "", digits, mapping.decimal) -
          Math.abs(parseMoney(cells[outflow] ?? "", digits, mapping.decimal)),
    payee: cells[payee] ?? "",
    notes: notes >= 0 ? (cells[notes] ?? "").trim() : undefined,
  }))
  return importTransactions(actor, accountId, rows)
}
