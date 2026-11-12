import { z } from "zod"
import {
  listPayees,
  mergePayees,
  renamePayee,
  setPayeeCategory,
} from "../../data"
import { defineTool } from "../tool"
import { page, zId, zLimit, zOffset } from "./common"

export const listPayeesTool = defineTool({
  name: "list_payees",
  title: "List payees",
  description:
    "Payees by name with how many transactions each has, optionally only those whose name contains search; paged. Useful for spotting duplicates to merge.",
  input: {
    search: z.string().optional(),
    limit: zLimit(200, 1000),
    offset: zOffset,
  },
  kind: "read",
  run: ({ search, limit = 200, offset = 0 }) => {
    const result = listPayees({ search, limit, offset })
    return page(result.items, result.total, offset)
  },
})

export const renamePayeeTool = defineTool({
  name: "rename_payee",
  title: "Rename a payee",
  description:
    "Renames a payee everywhere it is used. If the name is taken, merge the two with merge_payees instead.",
  input: { id: zId, name: z.string() },
  kind: "write",
  idempotent: true,
  run: ({ id, name }, { actor }) => renamePayee(actor(), id, name),
})

export const setPayeeCategoryTool = defineTool({
  name: "set_payee_category",
  title: "Set a payee's default category",
  description:
    "Sets the category that new transactions from this payee get when they arrive without one (bank sync, CSV import, or a new transaction with no categoryId). Existing transactions are not changed. categoryId null clears it.",
  input: { id: zId, categoryId: zId.nullable() },
  kind: "write",
  idempotent: true,
  run: ({ id, categoryId }, { actor }) =>
    setPayeeCategory(actor(), id, categoryId),
})

export const mergePayeesTool = defineTool({
  name: "merge_payees",
  title: "Merge payees",
  description:
    "Moves every transaction of the fromIds payees onto intoId and deletes the fromIds payees, e.g. to fold 'AMZN Mktp' and 'Amazon.de' into 'Amazon'.",
  input: { intoId: zId, fromIds: z.array(zId).min(1) },
  kind: "destructive",
  run: ({ intoId, fromIds }, { actor }) =>
    mergePayees(actor(), intoId, fromIds),
})
