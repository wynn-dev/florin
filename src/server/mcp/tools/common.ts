// Input pieces and compact result shapes the tools share.
import { z } from "zod"
import { listAccounts } from "../../data"
import type { Account, Transaction } from "@/shared/types"

export const zId = z.number().int().positive()
export const zDate = z.string().describe("YYYY-MM-DD")
export const zMonth = z.string().describe("YYYY-MM")
export const zAmount = z
  .number()
  .int()
  .describe(
    "Integer minor units (cents); negative = money out, positive = money in"
  )
export const zLimit = (fallback: number, max: number) =>
  z
    .number()
    .int()
    .min(1)
    .max(max)
    .optional()
    .describe(`Page size, default ${fallback}, at most ${max}`)
export const zOffset = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe("Skip this many, for the next page")

/** A page of results with what to ask for next. */
export function page<T>(items: T[], total: number, skipped = 0) {
  const next = skipped + items.length
  return {
    total,
    offset: skipped,
    ...(next < total ? { nextOffset: next } : {}),
    items,
  }
}

export function accountCurrencies(): Map<number, string> {
  return new Map(listAccounts().map((a) => [a.id, a.currency]))
}

/** An account in a few fields; budgetBalance only when it differs from balance. */
export function compactAccount(a: Account, budgetCurrency: string) {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    currency: a.currency,
    onBudget: a.onBudget,
    ...(a.closed ? { closed: true } : {}),
    balance: a.balance,
    ...(a.clearedBalance !== a.balance
      ? { clearedBalance: a.clearedBalance }
      : {}),
    ...(a.currency !== budgetCurrency
      ? { [`balanceIn${budgetCurrency}`]: a.budgetBalance }
      : {}),
    ...(a.provider ? { linkedTo: a.provider } : {}),
  }
}

/** A transaction in a few fields, empty ones left out; amount is in `currency`, the account's. */
export function compactTransaction(
  t: Transaction,
  currencies: Map<number, string>
) {
  return {
    id: t.id,
    date: t.date,
    accountId: t.accountId,
    account: t.accountName,
    amount: t.amount,
    currency: currencies.get(t.accountId),
    ...(t.payeeName ? { payee: t.payeeName } : {}),
    ...(t.importedPayee && t.importedPayee !== t.payeeName
      ? { bankText: t.importedPayee }
      : {}),
    ...(t.categoryId
      ? { categoryId: t.categoryId, category: t.categoryName }
      : {}),
    ...(t.transferId
      ? {
          transferId: t.transferId,
          transferAccountId: t.transferAccountId,
          transferAccount: t.transferAccountName,
        }
      : {}),
    ...(t.notes ? { notes: t.notes } : {}),
    ...(t.status === "pending" ? { status: "pending" } : {}),
  }
}
