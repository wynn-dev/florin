// Exact decimal arithmetic for Flex values. IBKR sends numbers as decimal
// strings with up to nine or more decimals; money is rounded to minor units
// only at the end, half away from zero, never through a JS float.

type Decimal = { units: bigint; scale: number }

/** Flex's ways of saying "no value". */
const NULLS = new Set(["", "-", "--", "N/A"])

export function isBlank(value: string | undefined): boolean {
  return value === undefined || NULLS.has(value.trim())
}

function parse(value: string, field: string): Decimal {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(value.trim())
  if (!m || (!m[2] && !m[3])) throw new Error(`${field} is not a number`)
  const frac = m[3] ?? ""
  const units = BigInt((m[2] || "0") + frac)
  return { units: m[1] === "-" ? -units : units, scale: frac.length }
}

/** Divides by 10^shift, rounding half away from zero. */
function shiftRound(units: bigint, shift: number): bigint {
  if (shift <= 0) return units * 10n ** BigInt(-shift)
  const div = 10n ** BigInt(shift)
  const q = units / div
  const r = units % div
  const twice = (r < 0n ? -r : r) * 2n
  if (twice >= div) return units < 0n ? q - 1n : q + 1n
  return q
}

/** A decimal string as minor units with `digits` decimals: toMinor("95370.02", 2) → 9537002. */
export function toMinor(
  value: string,
  digits: number,
  field = "amount"
): number {
  const d = parse(value, field)
  return Number(shiftRound(d.units, d.scale - digits))
}

/** The product of two decimal strings as minor units: an amount times its rate to base. */
export function mulToMinor(
  value: string,
  rate: string,
  digits: number,
  field = "amount"
): number {
  const a = parse(value, field)
  const b = parse(rate, `${field} rate`)
  return Number(shiftRound(a.units * b.units, a.scale + b.scale - digits))
}

/** A decimal string as a JS number, for quantities and prices that are shown, not summed. */
export function toNumber(value: string, field = "value"): number {
  parse(value, field)
  return Number(value)
}
