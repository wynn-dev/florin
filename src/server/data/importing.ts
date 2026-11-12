// The one path for bringing outside transactions in, used by CSV import, the
// bank connector and the MCP: rows carry the source's own id, a row whose id
// the account already has is skipped, and the rules name and categorise the
// rest and make moves between the person's own accounts transfers.
import { createHash } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { db, schema } from "../db"
import { getAccount } from "./accounts"
import { logChange, money } from "./changes"
import { payeeCategory, payeeIdForName } from "./payees"
import { getCategory } from "./categories"
import { loadRules, runRules, transfersOnArrival } from "./rules"
import { minorDigits } from "./fx"
import {
  checkAmount,
  checkDate,
  checkList,
  checkObject,
  InvalidInput,
  NotFound,
} from "./validate"
import type { Database } from "../db"
import type { CompiledRule } from "./rules"
import type {
  Account,
  Actor,
  CsvMapping,
  ImportResult,
  ImportRow,
} from "@/shared/types"
import type { CsvPreview } from "@/shared/import"

const { transactions } = schema

/**
 * Adds rows to an account, skipping any whose importedId is already there.
 * Rows without an importedId get one derived from date, amount and payee
 * (with a counter for identical rows), so importing the same file twice adds
 * nothing the second time. Each new row goes through the rules, which may set
 * its payee and category; a category given with the row wins over theirs,
 * and the payee's default category is the fallback. A row in an off-budget
 * account gets only a category given with it: categories mean nothing there.
 * A row a rule makes a transfer becomes one (see transfersOnArrival), and
 * rows elsewhere waiting for theirs in this account are linked. Each added
 * row is logged on its own, all in one Activity entry, so a transaction's
 * history starts with who brought it in.
 */
export function importTransactions(
  actor: Actor,
  accountId: number,
  rows: ImportRow[]
): ImportResult {
  const account = getAccount(accountId)
  const prepared = prepareRows(rows)
  return db().transaction((tx) => {
    const existing = existingIds(tx, accountId, prepared)
    const rules = loadRules(tx)
    const arrived: Parameters<typeof transfersOnArrival>[3] = []
    let change: number | undefined
    for (const row of prepared) {
      if (existing.has(row.importedId)) continue
      existing.add(row.importedId)
      const ruled = ruleRow(tx, rules, account, row)
      const payee = ruled.payee
      const { id } = tx
        .insert(transactions)
        .values({
          accountId,
          date: row.date,
          amount: row.amount,
          payeeId: ruled.payeeId,
          categoryId: ruled.categoryId,
          notes: row.notes ?? "",
          status: row.status ?? "cleared",
          importedId: row.importedId,
          importedPayee: row.payee || null,
          bookedDate: row.bookedDate ?? null,
        })
        .returning({ id: transactions.id })
        .get()
      change = logChange(tx, actor, {
        action: "create",
        entity: "transaction",
        entityId: id,
        summary: `Added ${money(row.amount, account.currency)} ${payee ? `at ${payee} ` : ""}in ${account.name} on ${row.date}`,
        detail: "Added",
      })
      arrived.push({
        id,
        date: row.date,
        transferAccountId: ruled.transferAccountId,
      })
    }
    transfersOnArrival(tx, actor, accountId, arrived, rules)
    const added = arrived.length
    return { added, skipped: prepared.length - added, change }
  })
}

/**
 * What the rules give a new row: its payee (only the final name becomes a
 * payee: a bank name a rule always replaces never does), its category (one
 * given with the row, else the rules', else the payee's default; none off
 * budget unless given) and the account it is a transfer to.
 */
export function ruleRow(
  tx: Parameters<typeof payeeIdForName>[1],
  rules: CompiledRule[],
  account: Pick<Account, "id" | "onBudget">,
  row: Pick<ImportRow, "payee" | "notes" | "categoryId">
): {
  payee: string | null
  payeeId: number | null
  categoryId: number | null
  transferAccountId: number | null
} {
  const ruled = runRules(rules, {
    bankText: row.payee || null,
    notes: row.notes ?? "",
    payee: row.payee ? cleanPayee(row.payee) : null,
    accountId: account.id,
  })
  const payeeId = ruled.payee ? payeeIdForName(ruled.payee, tx) : null
  return {
    payee: ruled.payee,
    payeeId,
    categoryId:
      row.categoryId ??
      (account.onBudget
        ? (ruled.categoryId ?? payeeCategory(payeeId, tx))
        : null),
    transferAccountId: ruled.transferAccountId,
  }
}

type PreparedRow = ImportRow & { importedId: string; payee: string }

function prepareRows(rows: ImportRow[]): PreparedRow[] {
  const seen = new Map<string, number>()
  return checkList(rows, "rows").map((row, i) => {
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
}

/** The importedIds among `rows` that the account already has. */
function existingIds(
  tx: Pick<Database, "select">,
  accountId: number,
  rows: PreparedRow[]
): Set<string> {
  const ids = rows.map((r) => r.importedId)
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
  return existing
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
export function cleanPayee(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim()
  if (name !== name.toUpperCase()) return name
  // Capitalise each word's first letter; \b is ASCII-only, so it would also
  // capitalise after Ä or Ö ("KÄYTTÖ" → "KÄyttÖ").
  return name
    .toLowerCase()
    .replace(
      /(^|[^\p{L}\p{N}'’])(\p{L})/gu,
      (_, before: string, c: string) => before + c.toUpperCase()
    )
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
  // A time after the date ("2026-11-10 14:22", "…T14:22:01") is dropped.
  const parts = value.trim().split(/[\sT]/)[0].split(/[-/.]/)
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

/** Reads a CSV file's rows with a mapping of its columns, by header name. */
function csvRows(
  accountId: number,
  csv: string,
  mapping: CsvMapping
): { header: string[]; lines: string[][]; rows: ImportRow[] } {
  checkObject(mapping, "mapping")
  const digits = minorDigits(getAccount(accountId).currency)
  const [header, ...lines] = parseCsv(csv)
  if (!header) throw new InvalidInput("the file is empty")
  const col = (name: string | undefined) => {
    if (name === undefined || name === "") return -1
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
  if (date < 0) throw new InvalidInput("map the date column")
  if (amount < 0 && inflow < 0 && outflow < 0)
    throw new InvalidInput("map an amount column, or inflow and outflow")
  const rows: ImportRow[] = lines.map((cells, i) => {
    try {
      return {
        date: parseDate(cells[date] ?? "", mapping.dateFormat),
        amount:
          amount >= 0
            ? parseMoney(cells[amount] ?? "", digits, mapping.decimal)
            : parseMoney(cells[inflow] ?? "", digits, mapping.decimal) -
              Math.abs(
                parseMoney(cells[outflow] ?? "", digits, mapping.decimal)
              ),
        payee: payee >= 0 ? (cells[payee] ?? "") : "",
        notes: notes >= 0 ? (cells[notes] ?? "").trim() : undefined,
      }
    } catch (error) {
      if (error instanceof InvalidInput)
        error.message = `row ${i + 2}: ${error.message}`
      throw error
    }
  })
  return { header, lines, rows }
}

/** Imports a CSV file into an account, mapping columns by their header names. */
export function importCsv(
  actor: Actor,
  accountId: number,
  csv: string,
  mapping: CsvMapping
): ImportResult {
  return importTransactions(
    actor,
    accountId,
    csvRows(accountId, csv, mapping).rows
  )
}

/**
 * Reads a CSV file without importing it: its headers, the first rows, the
 * mapping (the one given, or a guess from the headers and values) and how
 * many rows would be added and how many the account already has.
 */
export function previewCsv(
  accountId: number,
  csv: string,
  mapping?: CsvMapping
): CsvPreview {
  getAccount(accountId)
  if (typeof csv !== "string") throw new InvalidInput("csv must be text")
  const [header, ...lines] = parseCsv(csv)
  if (!header) throw new InvalidInput("the file is empty")
  const used = mapping ?? guessMapping(header, lines)
  const preview: CsvPreview = {
    headers: header,
    sample: lines.slice(0, 5),
    mapping: used,
    rows: lines.length,
    added: null,
    skipped: null,
    error: null,
  }
  try {
    const prepared = prepareRows(csvRows(accountId, csv, used).rows)
    const existing = existingIds(db(), accountId, prepared)
    const skipped = prepared.filter((r) => existing.has(r.importedId)).length
    return { ...preview, added: prepared.length - skipped, skipped }
  } catch (error) {
    if (error instanceof InvalidInput)
      return { ...preview, error: error.message }
    throw error
  }
}

const GUESSES: Record<
  "date" | "amount" | "inflow" | "outflow" | "payee" | "notes",
  RegExp[]
> = {
  date: [/^(transaction |booking |posted |value )?date$/, /date|datum|fecha/],
  amount: [/^amount/, /amount|betrag|bedrag|montant|importe|value|sum/],
  inflow: [/^(in|inflow|credit|paid in|money in|deposits?)\b/],
  outflow: [/^(out|outflow|debit|paid out|money out|withdrawals?)\b/],
  payee: [
    /^payee|^merchant|^counterparty|^name/,
    /payee|merchant|counterparty|description|beschreibung|omschrijving|name/,
  ],
  notes: [/memo|note|reference|remittance|purpose|details/],
}

/** Guesses which column is which from the headers, and the date and number formats from the values. */
export function guessMapping(header: string[], lines: string[][]): CsvMapping {
  const taken = new Set<string>()
  const find = (field: keyof typeof GUESSES) => {
    for (const pattern of GUESSES[field]) {
      const hit = header.find(
        (h) => !taken.has(h) && pattern.test(h.trim().toLowerCase())
      )
      if (hit) {
        taken.add(hit)
        return hit
      }
    }
    return undefined
  }
  const date = find("date") ?? header[0]
  taken.add(date)
  const amount = find("amount")
  const inflow = amount ? undefined : find("inflow")
  const outflow = amount ? undefined : find("outflow")
  const payee = find("payee") ?? ""
  const notes = find("notes")
  const column = (name: string | undefined) =>
    name === undefined
      ? []
      : lines
          .slice(0, 50)
          .map((cells) => (cells[header.indexOf(name)] ?? "").trim())
          .filter(Boolean)

  const dates = column(date).map((v) => v.split(/[\sT]/)[0])
  let dateFormat: CsvMapping["dateFormat"] = "YYYY-MM-DD"
  if (!dates.every((d) => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(d))) {
    const parts = dates.map((d) => d.split(/[-/.]/).map(Number))
    dateFormat = dates.some((d) => d.includes("."))
      ? "DD.MM.YYYY"
      : parts.some((p) => p[1] > 12)
        ? "MM/DD/YYYY"
        : "DD/MM/YYYY"
  }
  const amounts = [amount, inflow, outflow].flatMap(column)
  const decimal: "." | "," =
    amounts.some((v) => /\d,\d{1,2}\)?$/.test(v)) &&
    !amounts.some((v) => /\d\.\d{1,2}\)?$/.test(v))
      ? ","
      : "."
  return { date, amount, inflow, outflow, payee, notes, dateFormat, decimal }
}
