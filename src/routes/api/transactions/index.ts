import { createFileRoute } from "@tanstack/react-router"
import {
  createTransaction,
  createTransactions,
  deleteTransactions,
  listTransactions,
  updateTransactions,
} from "@/server/data"
import { body, optionalInt, query, respond } from "@/server/http"
import { InvalidInput } from "@/server/data/validate"
import type {
  NewTransaction,
  TransactionPatch,
  TransactionStatus,
} from "@/shared/types"

function ids(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every((n) => Number.isSafeInteger(n)))
    throw new InvalidInput("ids must be a list of transaction ids")
  return value as number[]
}

export const Route = createFileRoute("/api/transactions/")({
  server: {
    handlers: {
      /** Filters: accountId, categoryId, payeeId, uncategorized=1, status, from, to, search, limit, offset. */
      GET: ({ request }) =>
        respond(() => {
          const q = query(request)
          return listTransactions({
            accountId: optionalInt(q.accountId),
            categoryId: optionalInt(q.categoryId),
            payeeId: optionalInt(q.payeeId),
            uncategorized:
              q.uncategorized === "1" || q.uncategorized === "true",
            status: q.status as TransactionStatus | undefined,
            from: q.from,
            to: q.to,
            search: q.search,
            limit: optionalInt(q.limit),
            offset: optionalInt(q.offset),
          })
        }),
      /** One transaction, or a list of them (added all together or not at all). */
      POST: ({ request }) =>
        respond(async () => {
          const input = await request.json()
          return Array.isArray(input)
            ? createTransactions("person", input as NewTransaction[])
            : createTransaction("person", input as NewTransaction)
        }),
      /** { ids, patch }: the same change to many transactions, e.g. { categoryId } or { payeeName }. */
      PATCH: ({ request }) =>
        respond(async () => {
          const input = await body<{ ids: number[]; patch: TransactionPatch }>(
            request
          )
          return updateTransactions("person", ids(input.ids), input.patch ?? {})
        }),
      /** { ids }: deletes them all, transfers with both legs. */
      DELETE: ({ request }) =>
        respond(async () =>
          deleteTransactions(
            "person",
            ids((await body<{ ids: number[] }>(request)).ids)
          )
        ),
    },
  },
})
