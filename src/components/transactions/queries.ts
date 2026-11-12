// Transactions' queries and the person's edits: optimistic where the table
// shows the result at once, rolled back with an error toast on failure, and
// followed by a refetch of everything the edit moves (balances, budget,
// reports, Activity).
import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"
import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import type { HistoryLine } from "@/shared/activity"
import type { CsvPreview } from "@/shared/import"
import type {
  CsvMapping,
  ImportResult,
  NewTransaction,
  Transaction,
  TransactionFilter,
  TransactionPage,
  TransactionPatch,
} from "@/shared/types"

export const PAGE_SIZE = 200

export function qs(params: object): string {
  const entries = Object.entries(params).filter(
    ([, v]) =>
      v !== undefined &&
      v !== "" &&
      v !== false &&
      !(Array.isArray(v) && v.length === 0)
  )
  return entries.length
    ? "?" +
        new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()
    : ""
}

export const transactionQueries = {
  list: (filter: TransactionFilter) =>
    infiniteQueryOptions({
      queryKey: ["transactions", "list", filter],
      queryFn: ({ pageParam }) =>
        api<TransactionPage>(
          `/transactions${qs({ ...filter, limit: PAGE_SIZE, offset: pageParam })}`
        ),
      initialPageParam: 0,
      getNextPageParam: (last, pages) => {
        const loaded = pages.reduce((n, p) => n + p.items.length, 0)
        return loaded < last.total ? loaded : undefined
      },
    }),
  /** How many on-budget transactions still need a category. */
  uncategorized: (accountId?: number) =>
    queryOptions({
      queryKey: ["transactions", "uncategorized", accountId ?? null],
      queryFn: () =>
        api<TransactionPage>(
          `/transactions${qs({ uncategorized: true, accountId, limit: 1 })}`
        ).then((page) => page.total),
    }),
  /** The payee's most recent transaction, for its last-used category. */
  lastForPayee: (payeeId: number | null) =>
    queryOptions({
      queryKey: ["transactions", "payee-last", payeeId],
      queryFn: () =>
        api<TransactionPage>(`/transactions${qs({ payeeId, limit: 1 })}`).then(
          (page) => page.items[0] ?? null
        ),
      enabled: payeeId !== null,
    }),
  history: (id: number) =>
    queryOptions({
      queryKey: ["activity", "history", id],
      queryFn: () => api<HistoryLine[]>(`/activity/transactions/${id}`),
    }),
  convert: (amount: number, from: string, to: string, date: string) =>
    queryOptions({
      queryKey: ["fx", "convert", amount, from, to, date],
      queryFn: () =>
        api<{ amount: number | null }>(
          `/fx/convert${qs({ amount, from, to, date })}`
        ).then((r) => r.amount),
      staleTime: Infinity,
    }),
}

/** Everything a change to transactions can move. */
export function invalidateAfterEdit(client: QueryClient) {
  for (const key of [
    "transactions",
    "accounts",
    "budget",
    "reports",
    "activity",
    "payees",
  ])
    void client.invalidateQueries({ queryKey: [key] })
}

type ListData = InfiniteData<TransactionPage, number>

/** Applies `fn` to every loaded row of every transactions list; returns how to undo it. */
function patchLists(
  client: QueryClient,
  fn: (t: Transaction) => Transaction | null
): () => void {
  const saved = client.getQueriesData<ListData>({
    queryKey: ["transactions", "list"],
  })
  for (const [key, data] of saved) {
    if (!data) continue
    const pages = data.pages.map((page) => ({
      ...page,
      items: page.items.flatMap((t) => fn(t) ?? []),
    }))
    // Rows taken out leave the total too, or paging would ask for rows that aren't there.
    const removed =
      data.pages.reduce((n, p) => n + p.items.length, 0) -
      pages.reduce((n, p) => n + p.items.length, 0)
    client.setQueryData<ListData>(key, {
      ...data,
      pages: pages.map((page) => ({ ...page, total: page.total - removed })),
    })
  }
  return () => {
    for (const [key, data] of saved) client.setQueryData(key, data)
  }
}

function errorToast(error: Error, retry: () => void) {
  toast.error(error.message || "That didn't save.", {
    action: { label: "Retry", onClick: retry },
  })
}

/**
 * Applies one patch to several transactions. `preview` is how a row looks
 * once patched, shown at once; `keep` leaves the current list in place (the
 * Uncategorised view keeps categorised rows, dimmed, until the person leaves).
 */
export function useUpdateTransactions() {
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: {
      ids: number[]
      patch: TransactionPatch
      preview?: (t: Transaction) => Transaction
      keep?: boolean
    }) =>
      api<Transaction[]>("/transactions", {
        method: "PATCH",
        body: { ids: input.ids, patch: input.patch },
      }),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: ["transactions", "list"] })
      const ids = new Set(input.ids)
      const preview = input.preview
      return {
        rollback: preview
          ? patchLists(client, (t) => (ids.has(t.id) ? preview(t) : t))
          : () => {},
      }
    },
    onError: (error, input, context) => {
      context?.rollback()
      errorToast(error, () => mutation.mutate(input))
    },
    onSuccess: (updated) => {
      const byId = new Map(updated.map((t) => [t.id, t]))
      patchLists(client, (t) => {
        const fresh = byId.get(t.id)
        // A fresh row lacks the running balance only the list computes.
        return fresh ? { ...fresh, balance: t.balance } : t
      })
    },
    onSettled: (_data, _error, input) => {
      if (!input.keep) return invalidateAfterEdit(client)
      for (const key of ["accounts", "budget", "reports", "activity"])
        void client.invalidateQueries({ queryKey: [key] })
      void client.invalidateQueries({
        queryKey: ["transactions"],
        refetchType: "none",
      })
      void client.invalidateQueries({
        queryKey: ["transactions", "uncategorized"],
      })
    },
  })
  return mutation
}

/** What re-creates a deleted transaction, bank fields included so a later sync still skips it. */
function recreate(t: Transaction): NewTransaction {
  return {
    accountId: t.accountId,
    date: t.date,
    amount: t.amount,
    payeeId: t.transferId ? undefined : t.payeeId,
    categoryId: t.categoryId,
    notes: t.notes,
    status: t.status,
    transferAccountId: t.transferAccountId ?? undefined,
    transferAmount: t.transferAmount ?? undefined,
    importedId: t.importedId,
    importedPayee: t.importedPayee,
    bookedDate: t.bookedDate,
  }
}

/** Deletes at once, with "Deleted 3 transactions · Undo" re-creating them. */
export function useDeleteTransactions() {
  const client = useQueryClient()
  const restore = useMutation({
    mutationFn: (rows: NewTransaction[]) =>
      api<Transaction[]>("/transactions", { method: "POST", body: rows }),
    onError: (error, rows) => errorToast(error, () => restore.mutate(rows)),
    onSettled: () => invalidateAfterEdit(client),
  })
  const mutation = useMutation({
    mutationFn: (rows: Transaction[]) =>
      api<void>("/transactions", {
        method: "DELETE",
        body: { ids: rows.map((t) => t.id) },
      }),
    onMutate: async (rows) => {
      await client.cancelQueries({ queryKey: ["transactions", "list"] })
      const gone = new Set(rows.flatMap((t) => [t.id, t.transferId ?? 0]))
      return {
        rollback: patchLists(client, (t) => (gone.has(t.id) ? null : t)),
      }
    },
    onError: (error, rows, context) => {
      context?.rollback()
      errorToast(error, () => mutation.mutate(rows))
    },
    onSuccess: (_data, rows) => {
      // Deleting either leg of a transfer deletes both; re-create each transfer once.
      const seen = new Set<number>()
      const again = rows.filter((t) => {
        if (seen.has(t.id)) return false
        seen.add(t.id)
        if (t.transferId) seen.add(t.transferId)
        return true
      })
      toast(
        again.length === 1
          ? "Deleted 1 transaction"
          : `Deleted ${again.length} transactions`,
        {
          action: {
            label: "Undo",
            onClick: () => restore.mutate(again.map(recreate)),
          },
        }
      )
    },
    onSettled: () => invalidateAfterEdit(client),
  })
  return mutation
}

/** Adds a transaction (id absent) or saves changes to one. */
export function useSaveTransaction() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (
      input:
        | { id: number; patch: TransactionPatch }
        | { id?: undefined; create: NewTransaction }
    ) =>
      input.id === undefined
        ? api<Transaction>("/transactions", {
            method: "POST",
            body: input.create,
          })
        : api<Transaction>(`/transactions/${input.id}`, {
            method: "PATCH",
            body: input.patch,
          }),
    onSettled: () => invalidateAfterEdit(client),
  })
}

export function previewCsv(
  accountId: number,
  csv: string,
  mapping?: CsvMapping
) {
  return api<CsvPreview>(`/accounts/${accountId}/import-preview`, {
    method: "POST",
    body: { csv, mapping },
  })
}

export function importCsv(
  accountId: number,
  csv: string,
  mapping: CsvMapping,
  fileName: string
) {
  return api<ImportResult>(`/accounts/${accountId}/import`, {
    method: "POST",
    body: { csv, mapping, fileName },
  })
}
