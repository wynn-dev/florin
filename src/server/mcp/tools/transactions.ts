import { z } from "zod"
import {
  createTransactions,
  deleteTransactions,
  importCsv,
  importTransactions,
  linkTransfers,
  listTransactions,
  patchTransactions,
  suggestTransfers,
} from "../../data"
import { InvalidInput } from "../../data/validate"
import { defineTool } from "../tool"
import {
  accountCurrencies,
  compactTransaction,
  page,
  zAmount,
  zDate,
  zId,
  zLimit,
  zOffset,
} from "./common"
import type { Transaction } from "@/shared/types"

const status = z.enum(["pending", "cleared"])

function compact(items: Transaction[]) {
  const currencies = accountCurrencies()
  return items.map((t) => compactTransaction(t, currencies))
}

export const searchTransactions = defineTool({
  name: "search_transactions",
  title: "Search transactions",
  description:
    "Finds transactions, newest first, with paging (use nextOffset for the next page). Filters combine: account, category, payee, uncategorized (on-budget transactions that still need a category), status, date range, text (matches payee, bank text, notes and category) and amount range. Amounts are integer minor units in each row's currency; negative = money out, so spending over €50 is maxAmount: -5000. Rows leave out empty fields; status shows only when pending; bankText is the bank's own description when it differs from the payee; a transfer shows transferId (the other leg's id) and transferAccount, the account the money moved to or came from.",
  input: {
    accountId: zId.optional(),
    categoryId: zId.optional(),
    payeeId: zId.optional(),
    uncategorized: z.boolean().optional(),
    status: status.optional(),
    from: zDate.optional(),
    to: zDate.optional(),
    text: z.string().optional(),
    minAmount: zAmount.optional(),
    maxAmount: zAmount.optional(),
    limit: zLimit(50, 500),
    offset: zOffset,
  },
  kind: "read",
  run: ({ text, limit = 50, offset = 0, ...filter }) => {
    const result = listTransactions({ ...filter, search: text, limit, offset })
    return page(compact(result.items), result.total, offset)
  },
})

const newTransaction = z.object({
  accountId: zId,
  date: zDate,
  amount: zAmount,
  payee: z
    .string()
    .optional()
    .describe("Payee name; created when new (matched case-insensitively)"),
  payeeId: zId.optional(),
  categoryId: zId.nullable().optional(),
  notes: z.string().optional(),
  status: status.optional().describe("Default cleared"),
  transferAccountId: zId
    .optional()
    .describe("Makes it a transfer: the other leg is created in this account"),
  transferAmount: zAmount
    .optional()
    .describe(
      "What arrives in the other account, in its currency; needed when the two accounts' currencies differ (defaults to -amount)"
    ),
})

export const addTransactions = defineTool({
  name: "add_transactions",
  title: "Add transactions",
  description:
    "Adds up to 500 transactions in one call, all or none (an error names the item to fix). amount is integer minor units in the account's currency; negative = money out. Give a payee by name (created when new) or payeeId. A transfer between two accounts is one item with transferAccountId: amount leaves or enters accountId and the mirrored leg is created; between currencies also give transferAmount, what the other account receives in its own currency (e.g. amount -10000 EUR, transferAmount 10850 USD). Transfers need no payee, and none between two on-budget accounts needs a category. When both sides are already in florin (each bank or the broker sent its own row), don't add a transfer, which would duplicate the other side: link the two rows with link_transfers.",
  input: { transactions: z.array(newTransaction).min(1).max(500) },
  kind: "write",
  run: ({ transactions }, { actor }) => {
    const created = createTransactions(
      actor(),
      transactions.map(({ payee, ...t }) => ({ ...t, payeeName: payee }))
    )
    return { added: created.length, items: compact(created) }
  },
})

const update = z.object({
  id: zId,
  categoryId: zId.nullable().optional().describe("null clears the category"),
  payee: z.string().optional().describe("Payee name; created when new"),
  payeeId: zId.nullable().optional().describe("null clears the payee"),
  date: zDate.optional(),
  amount: zAmount.optional(),
  notes: z.string().optional(),
  status: status.optional(),
  accountId: zId.optional().describe("Moves it to another account"),
  transferAccountId: zId
    .nullable()
    .optional()
    .describe(
      "Turns it into a transfer to this account by creating the other leg there, or null to make it a plain transaction: the other leg stays as a plain transaction when it came from a bank or an import or the two were linked with link_transfers, and is deleted when florin created it"
    ),
  transferAmount: zAmount.optional(),
})

export const updateTransactions = defineTool({
  name: "update_transactions",
  title: "Update transactions",
  description:
    "Changes up to 500 transactions in one call, each with its own fields (e.g. a different categoryId per transaction when categorising), all or none; an error names the item to fix. Only the fields given change. Changing one leg of a transfer keeps the other leg mirrored, except that a leg from a bank or an import, or one linked with link_transfers, keeps its own date, notes and status. transferAccountId creates the other leg (between two on-budget accounts the category is cleared, as for every transfer); when that row already exists (the other bank sent it), use link_transfers instead, and for moves that recur a rule with transferAccountId.",
  input: { updates: z.array(update).min(1).max(500) },
  kind: "write",
  run: ({ updates }, { actor }) => {
    const changed = patchTransactions(
      actor(),
      updates.map(({ payee, ...u }) => ({
        ...u,
        ...(payee !== undefined ? { payeeName: payee } : {}),
      }))
    )
    return { updated: changed.length, items: compact(changed) }
  },
})

export const deleteTransactionsTool = defineTool({
  name: "delete_transactions",
  title: "Delete transactions",
  description:
    "Deletes transactions by id, all or none. Deleting a leg of a transfer deletes the other leg too when florin created it; a leg from a bank or an import, or one linked with link_transfers, stays as a plain transaction.",
  input: { ids: z.array(zId).min(1).max(500) },
  kind: "destructive",
  run: ({ ids }, { actor }) => {
    deleteTransactions(actor(), ids)
    return { deleted: ids.length }
  },
})

export const linkTransfersTool = defineTool({
  name: "link_transfers",
  title: "Link transactions as transfers",
  description:
    "Links pairs of transactions already in florin as transfers, for money moved between two of the person's accounts when each side arrived on its own (two banks' syncs, or the bank and the broker). Up to 100 pairs, all or none, one Activity entry. Each pair: two transactions in different accounts, neither already a transfer, one money out and one money in; in one currency the amounts must mirror exactly (the error says by how much they differ), across currencies each leg keeps its own amount. Linked, they behave like any transfer: no payee, no category between two on-budget accounts (the on-budget leg keeps its category when the other account is off budget), and they leave spending and income reports. Each keeps its date, status, notes, bank text and bank id, so later syncs add nothing. Unlink with update_transactions transferAccountId: null, which keeps both rows but not the payees and categories linking cleared: give those back in the same update_transactions call (each row's payeeId and categoryId as search_transactions showed them before linking). Find pairs with suggest_transfers. A starting balance can't be linked. For moves that recur (each month to the broker or savings), add a rule with transferAccountId (save_rules) instead, so florin links them as they arrive; use apply_rules for those already in. Example: { pairs: [[812, 815], [901, 977]] }.",
  input: {
    pairs: z
      .array(z.array(zId).length(2))
      .min(1)
      .max(100)
      .describe("Each a pair of transaction ids, in either order"),
  },
  kind: "write",
  run: ({ pairs }, { actor }) => {
    const linked = linkTransfers(
      actor(),
      pairs.map(([a, b]) => [a, b])
    )
    const currencies = accountCurrencies()
    return {
      linked: linked.length,
      pairs: linked.map(([out, into]) => ({
        out: compactTransaction(out, currencies),
        into: compactTransaction(into, currencies),
      })),
    }
  },
})

export const suggestTransfersTool = defineTool({
  name: "suggest_transfers",
  title: "Suggest transfers to link",
  description:
    'Likely transfers among transactions that aren\'t linked yet: money out of one account and into another within 4 days, for the same amount in one currency, or within 3% at that day\'s exchange rate between two currencies. Each transaction is in at most one suggestion (the closest dates win); newest first, each with both rows (out, into) and how many days apart they are. In an investment account only the broker\'s cash deposits and withdrawals are offered, never trades, interest, dividends, fees or currency conversions; starting balances never. Check that a pair is really the person\'s own money moving (not a payment to someone with the same amount), then pass the ids to link_transfers; when the same move recurs, a rule with transferAccountId (save_rules) links it on arrival from then on. from/to bound the dates; accountId keeps pairs with a side in that account. Example: { from: "2026-10-01", accountId: 3 } → [{ out: { id: 812, account: "Current account", amount: -100000, … }, into: { id: 815, account: "Broker", amount: 116740, currency: "USD", … }, days: 2 }].',
  input: {
    from: zDate.optional(),
    to: zDate.optional(),
    accountId: zId.optional(),
    limit: zLimit(50, 500),
    offset: zOffset,
  },
  kind: "read",
  run: ({ limit = 50, offset = 0, ...filter }) => {
    const all = suggestTransfers(filter)
    const currencies = accountCurrencies()
    return page(
      all.slice(offset, offset + limit).map((s) => ({
        out: compactTransaction(s.out, currencies),
        into: compactTransaction(s.into, currencies),
        days: s.days,
      })),
      all.length,
      offset
    )
  },
})

export const importTransactionsTool = defineTool({
  name: "import_transactions",
  title: "Import transactions",
  description:
    "Brings transactions from a statement into one account, skipping any already imported, so importing the same rows twice adds nothing. Give either rows (date, amount in integer minor units with negative = money out, payee text as the bank shows it, optional importedId from the bank) or csv text with a mapping of its column names. The rules (list_rules) set each new row's payee and category from its text, unless a row gives its own categoryId. Returns how many were added and skipped. Categorise what is left afterwards with search_transactions (uncategorized) and update_transactions, or add a rule (save_rules) so the next rows come in categorised.",
  input: {
    accountId: zId,
    rows: z
      .array(
        z.object({
          date: zDate,
          amount: zAmount,
          payee: z.string(),
          notes: z.string().optional(),
          importedId: z
            .string()
            .optional()
            .describe("The bank's own id, used to skip duplicates"),
          categoryId: zId.optional(),
          status: status.optional(),
        })
      )
      .max(5000)
      .optional(),
    csv: z
      .string()
      .optional()
      .describe("The CSV file's text, header row first"),
    mapping: z
      .object({
        date: z.string().describe("Column name"),
        amount: z.string().optional().describe("One signed amount column"),
        inflow: z.string().optional(),
        outflow: z.string().optional(),
        payee: z.string(),
        notes: z.string().optional(),
        dateFormat: z
          .enum(["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD.MM.YYYY"])
          .optional(),
        decimal: z.enum([".", ","]).optional().describe('"," for 1.234,56'),
      })
      .optional()
      .describe("Needed with csv: which columns hold what"),
  },
  kind: "write",
  run: ({ accountId, rows, csv, mapping }, { actor }) => {
    if ((rows === undefined) === (csv === undefined))
      throw new InvalidInput("give either rows or csv")
    if (csv !== undefined) {
      if (!mapping)
        throw new InvalidInput(
          "csv needs a mapping naming its date, payee and amount (or inflow/outflow) columns"
        )
      return importCsv(actor(), accountId, csv, mapping)
    }
    return importTransactions(actor(), accountId, rows!)
  },
})
