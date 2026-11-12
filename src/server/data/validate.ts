/** A request the data layer refuses; /api answers it with 400. */
export class InvalidInput extends Error {}

/** A missing record; /api answers it with 404. */
export class NotFound extends Error {}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** Refuses anything but a plain object (a JSON body or list item). */
export function checkObject<T>(value: T, what: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidInput(`${what} must be an object`)
  }
  return value
}

/** Refuses anything but a list. */
export function checkList<T>(value: T[], what: string): T[] {
  if (!Array.isArray(value)) throw new InvalidInput(`${what} must be a list`)
  return value
}

export function checkDate(value: unknown, field = "date"): string {
  if (typeof value !== "string" || !DATE.test(value)) {
    throw new InvalidInput(`${field} must be a date as YYYY-MM-DD`)
  }
  return value
}

export function checkMonth(value: unknown, field = "month"): string {
  if (typeof value !== "string" || !MONTH.test(value)) {
    throw new InvalidInput(`${field} must be a month as YYYY-MM`)
  }
  return value
}

/** Amounts are whole minor units (cents); fractions are refused, not rounded. */
export function checkAmount(value: unknown, field = "amount"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new InvalidInput(`${field} must be an integer number of cents`)
  }
  return value
}

export function checkName(value: unknown, field = "name"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidInput(`${field} is required`)
  }
  return value.trim()
}

export function found<T>(row: T | undefined, what: string): T {
  if (row === undefined) throw new NotFound(`${what} not found`)
  return row
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** "2026-03" → "2026-03-31" */
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

/** Every month from `from` to `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m)
  return out
}
