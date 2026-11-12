// Linking two existing transactions as one transfer: what the server and the
// dashboard's bulk bar both check, so both refuse with the same words.

/** The fields of a transaction the check needs. */
export type LinkCandidate = {
  id: number
  accountId: number
  amount: number
  transferId: number | null
}

/**
 * Why two transactions can't be linked as a transfer, or null when they can:
 * both plain rows (neither already a transfer), in different accounts, one
 * money out and the other money in; within one currency the amounts must
 * mirror exactly, across currencies each keeps its own. `money` formats an
 * amount in a currency, for the difference.
 */
export function linkProblem(
  a: LinkCandidate,
  b: LinkCandidate,
  currency: (accountId: number) => string,
  money: (amount: number, currency: string) => string
): string | null {
  if (a.id === b.id) return "pick two different transactions"
  if (a.transferId !== null || b.transferId !== null)
    return a.transferId !== null && b.transferId !== null
      ? "both are already transfers"
      : `transaction ${a.transferId !== null ? a.id : b.id} is already a transfer`
  if (a.accountId === b.accountId) return "both are in the same account"
  if (Math.sign(a.amount) * Math.sign(b.amount) !== -1)
    return "one must be money out and the other money in"
  const ca = currency(a.accountId)
  if (ca === currency(b.accountId) && a.amount + b.amount !== 0)
    return `the amounts differ by ${money(Math.abs(Math.abs(a.amount) - Math.abs(b.amount)), ca)}`
  return null
}
