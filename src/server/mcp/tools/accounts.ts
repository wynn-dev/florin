import { z } from "zod"
import {
  createAccount,
  deleteAccount,
  getSettings,
  listAccounts,
  updateAccount,
} from "../../data"
import { InvalidInput } from "../../data/validate"
import { defineTool } from "../tool"
import { compactAccount, zAmount, zDate, zId } from "./common"

const accountType = z.enum([
  "checking",
  "savings",
  "credit",
  "cash",
  "investment",
  "loan",
])

export const listAccountsTool = defineTool({
  name: "list_accounts",
  title: "List accounts",
  description:
    "Every account with its balance in its own currency (integer minor units), including closed ones unless includeClosed is false. clearedBalance appears when pending transactions make it differ; accounts in another currency also show their balance in the budget's currency.",
  input: { includeClosed: z.boolean().optional() },
  kind: "read",
  run: ({ includeClosed }) => {
    const { currency } = getSettings()
    return {
      currency,
      items: listAccounts()
        .filter((a) => includeClosed !== false || !a.closed)
        .map((a) => compactAccount(a, currency)),
    }
  },
})

export const saveAccount = defineTool({
  name: "save_account",
  title: "Create or change an account",
  description:
    "Without id: creates an account (name and type needed; currency defaults to the budget's; an opening balance is booked as a 'Starting balance' transaction). With id: changes its name, type, onBudget or closed. Close an account (closed: true) rather than deleting it to keep its history. Only accounts in the budget's currency can be on budget.",
  input: {
    id: zId
      .optional()
      .describe("The account to change; leave out to create one"),
    name: z.string().optional(),
    type: accountType.optional(),
    currency: z.string().optional().describe("ISO 4217, only when creating"),
    onBudget: z.boolean().optional(),
    closed: z.boolean().optional(),
    startingBalance: zAmount
      .optional()
      .describe("Only when creating; integer minor units"),
    startingDate: zDate
      .optional()
      .describe("Only when creating; defaults to today"),
  },
  kind: "write",
  run: (input, { actor }) => {
    const { currency } = getSettings()
    if (input.id === undefined) {
      if (!input.name || !input.type)
        throw new InvalidInput("a new account needs a name and a type")
      if (input.closed)
        throw new InvalidInput("a new account can't start closed")
      return compactAccount(
        createAccount(actor(), {
          name: input.name,
          type: input.type,
          currency: input.currency,
          onBudget: input.onBudget,
          startingBalance: input.startingBalance,
          startingDate: input.startingDate,
        }),
        currency
      )
    }
    if (
      input.currency !== undefined ||
      input.startingBalance !== undefined ||
      input.startingDate !== undefined
    )
      throw new InvalidInput(
        "currency and starting balance are set when an account is created; add a transaction to adjust a balance"
      )
    return compactAccount(
      updateAccount(actor(), input.id, {
        name: input.name,
        type: input.type,
        onBudget: input.onBudget,
        closed: input.closed,
      }),
      currency
    )
  },
})

export const deleteAccountTool = defineTool({
  name: "delete_account",
  title: "Delete an account",
  description:
    "Deletes an account and every transaction in it, for good; transfers to it become plain transactions in the other account. To stop using an account but keep its history, close it with save_account instead.",
  input: { id: zId },
  kind: "destructive",
  run: ({ id }, { actor }) => {
    deleteAccount(actor(), id)
    return { deleted: id }
  },
})
