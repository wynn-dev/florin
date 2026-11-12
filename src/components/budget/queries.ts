// The budget page's reads and writes. The person's edits are optimistic: the
// month is patched at once, rolled back with an error toast if the server
// refuses, and every budget month is refetched once it settles (an amount
// assigned in one month changes what carries into the next).
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { toast } from "sonner"
import type { QueryClient } from "@tanstack/react-query"
import type { BudgetCategoryDetail } from "@/shared/budget"
import type { BudgetMonth } from "@/shared/types"
import { api, queries } from "@/lib/api"

export const budgetQueries = {
  category: (month: string, categoryId: number) =>
    queryOptions({
      queryKey: ["budget", month, "category", categoryId],
      queryFn: () =>
        api<BudgetCategoryDetail>(`/budget/${month}/${categoryId}`),
    }),
  /** How many transactions a category has, for "Move its 37 transactions to …". */
  transactionCount: (categoryIds: number[]) =>
    queryOptions({
      queryKey: ["transactions", "count", categoryIds],
      queryFn: async () => {
        const counts = await Promise.all(
          categoryIds.map((id) =>
            api<{ total: number }>(
              `/transactions?categoryId=${id}&limit=1`
            ).then((page) => page.total)
          )
        )
        return counts.reduce((a, b) => a + b, 0)
      },
    }),
}

/** Adds `delta` to what is assigned to a category, as the server will. */
export function assignDelta(
  month: BudgetMonth,
  categoryId: number,
  delta: number
): BudgetMonth {
  return {
    ...month,
    budgeted: month.budgeted + delta,
    available: month.available + delta,
    toBudget: month.toBudget - delta,
    groups: month.groups.map((group) =>
      group.categories.some((c) => c.id === categoryId)
        ? {
            ...group,
            budgeted: group.budgeted + delta,
            available: group.available + delta,
            categories: group.categories.map((c) =>
              c.id === categoryId
                ? {
                    ...c,
                    budgeted: c.budgeted + delta,
                    available: c.available + delta,
                  }
                : c
            ),
          }
        : group
    ),
  }
}

function invalidateBudget(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["budget"] }),
    client.invalidateQueries({ queryKey: ["activity"] }),
  ])
}

/** Patches one month in the cache and returns how to undo the patch. */
async function patchMonth(
  client: QueryClient,
  month: string,
  patch: (current: BudgetMonth) => BudgetMonth
) {
  const key = queries.budget(month).queryKey
  await client.cancelQueries({ queryKey: key })
  const previous = client.getQueryData(key)
  if (previous) client.setQueryData(key, patch(previous))
  return () => client.setQueryData(key, previous)
}

export function useAssign(month: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { categoryId: number; amount: number; previous: number }) =>
      api<BudgetMonth>(`/budget/${month}/${v.categoryId}`, {
        method: "PUT",
        body: { amount: v.amount },
      }),
    onMutate: async (v) => ({
      rollback: await patchMonth(client, month, (m) =>
        assignDelta(m, v.categoryId, v.amount - v.previous)
      ),
    }),
    onError: (error, _v, context) => {
      context?.rollback()
      toast.error(`Couldn't assign: ${error.message}`)
    },
    onSettled: () => invalidateBudget(client),
  })
}

/** A move of money; null is Ready to assign. */
export type Move = {
  fromCategoryId: number | null
  toCategoryId: number | null
  amount: number
}

function postMove(month: string, move: Move) {
  return api<BudgetMonth>(`/budget/${month}/move`, {
    method: "POST",
    body: { moves: [move] },
  })
}

/**
 * Moves money, optimistically. With `toast`, a toast with Undo follows; it is
 * raised here rather than by the caller, whose popover has closed by then.
 */
export function useMoveMoney(month: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ toast: _, ...move }: Move & { toast?: string }) =>
      postMove(month, move),
    onMutate: async (move) => ({
      rollback: await patchMonth(client, month, (m) => {
        let next = m
        if (move.fromCategoryId !== null)
          next = assignDelta(next, move.fromCategoryId, -move.amount)
        if (move.toCategoryId !== null)
          next = assignDelta(next, move.toCategoryId, move.amount)
        return next
      }),
    }),
    onSuccess: (_month, move) => {
      if (!move.toast) return
      toast(move.toast, {
        action: {
          label: "Undo",
          onClick: () =>
            void postMove(month, {
              fromCategoryId: move.toCategoryId,
              toCategoryId: move.fromCategoryId,
              amount: move.amount,
            })
              .catch((error: Error) =>
                toast.error(`Couldn't undo: ${error.message}`)
              )
              .finally(() => invalidateBudget(client)),
        },
      })
    },
    onError: (error, _move, context) => {
      context?.rollback()
      toast.error(`Couldn't move money: ${error.message}`)
    },
    onSettled: () => invalidateBudget(client),
  })
}

/** Category and group edits: not optimistic, but quick, and refetch what they touch. */
export function useCategoryEdit<T>(
  fn: (input: T) => Promise<unknown>,
  failure: string
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onError: (error) => toast.error(`${failure}: ${error.message}`),
    onSettled: () =>
      Promise.all([
        invalidateBudget(client),
        client.invalidateQueries({ queryKey: ["categories"] }),
        client.invalidateQueries({ queryKey: ["transactions"] }),
      ]),
  })
}
