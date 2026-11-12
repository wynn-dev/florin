import { z } from "zod"
import {
  createTransactions,
  deleteTransactions,
  importCsv,
  importTransactions,
  listTransactions,
  patchTransactions,
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
    "Finds transactions, newest first, with paging (use nextOffset for the next page). Filters combine: account, category, payee, uncategorized (on-budget transactions that still need a category), status, date range, text (matches payee, bank text, notes and category) and amount range. Amounts are integer minor units in each row's currency; negative = money out, so spending over €50 is maxAmount: -5000. Rows leave out empty fields; status shows only when pending; bankText is the bank's own description when it differs from the payee.",
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
    "Adds up to 500 transactions in one call, all or none (an error names the item to fix). amount is integer minor units in the account's currency; negative = money out. Give a payee by name (created when new) or payeeId. A transfer between two accounts is one item with transferAccountId: amount leaves or enters accountId and the mirrored leg is created; between currencies also give transferAmount, what the other account receives in its own currency (e.g. amount -10000 EUR, transferAmount 10850 USD). Transfers need no payee, and none between two on-budget accounts needs a category.",
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
      "Turns it into a transfer to this account, or null to make it a plain transaction"
    ),
  transferAmount: zAmount.optional(),
})

export const updateTransactions = defineTool({
  name: "update_transactions",
  title: "Update transactions",
  description:
    "Changes up to 500 transactions in one call, each with its own fields (e.g. a different categoryId per transaction when categorising), all or none; an error names the item to fix. Only the fields given change. Changing one leg of a transfer keeps the other leg mirrored.",
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
    "Deletes transactions by id, all or none; deleting either leg of a transfer deletes both.",
  input: { ids: z.array(zId).min(1).max(500) },
  kind: "destructive",
  run: ({ ids }, { actor }) => {
    deleteTransactions(actor(), ids)
    return { deleted: ids.length }
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
