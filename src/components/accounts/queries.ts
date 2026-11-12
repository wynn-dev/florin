// The accounts pages' reads and the account edits behind their menus.
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { toast } from "sonner"
import type {
  Account,
  AccountPatch,
  AccountType,
  AccountValue,
  Holding,
  NewAccount,
} from "@/shared/types"
import { api } from "@/lib/api"

export const accountQueries = {
  account: (id: number) =>
    queryOptions({
      queryKey: ["accounts", id],
      queryFn: () => api<Account>(`/accounts/${id}`),
    }),
  /** A week apart over the last twelve months, ending today. */
  balances: (id: number) =>
    queryOptions({
      queryKey: ["accounts", id, "balances"],
      queryFn: () => api<AccountValue[]>(`/accounts/${id}/balances`),
    }),
  /** Every value snapshot (an investment account's NAV per trading day). */
  values: (id: number) =>
    queryOptions({
      queryKey: ["accounts", id, "values"],
      queryFn: () => api<AccountValue[]>(`/accounts/${id}/values`),
    }),
  holdings: (id: number) =>
    queryOptions({
      queryKey: ["accounts", id, "holdings"],
      queryFn: () => api<Holding[]>(`/accounts/${id}/holdings`),
    }),
  transactionCount: (id: number) =>
    queryOptions({
      queryKey: ["transactions", "count", { accountId: id }],
      queryFn: () =>
        api<{ total: number }>(`/transactions?accountId=${id}&limit=1`).then(
          (page) => page.total
        ),
    }),
}

/** The list's sections, in order, and the types in each. */
export const SECTIONS: { title: string; types: AccountType[] }[] = [
  { title: "Cash", types: ["checking", "savings", "cash"] },
  { title: "Credit", types: ["credit", "loan"] },
  { title: "Investments", types: ["investment"] },
]

export const TYPE_LABELS: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit card",
  cash: "Cash",
  investment: "Investment",
  loan: "Loan",
}

function useInvalidateAccounts() {
  const client = useQueryClient()
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["accounts"] }),
      client.invalidateQueries({ queryKey: ["reports"] }),
      client.invalidateQueries({ queryKey: ["budget"] }),
      client.invalidateQueries({ queryKey: ["activity"] }),
    ])
}

export function useCreateAccount() {
  const invalidate = useInvalidateAccounts()
  return useMutation({
    mutationFn: (input: NewAccount) =>
      api<Account>("/accounts", { method: "POST", body: input }),
    onSettled: invalidate,
  })
}

/** Rename, close or reopen; optimistic on the account's own query. */
export function useUpdateAccount(id: number) {
  const client = useQueryClient()
  const invalidate = useInvalidateAccounts()
  const key = accountQueries.account(id).queryKey
  return useMutation({
    mutationFn: (patch: AccountPatch) =>
      api<Account>(`/accounts/${id}`, { method: "PATCH", body: patch }),
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData(key)
      if (previous) client.setQueryData(key, { ...previous, ...patch })
      return { previous }
    },
    onError: (error, _patch, context) => {
      if (context?.previous) client.setQueryData(key, context.previous)
      toast.error(`Couldn't change the account: ${error.message}`)
    },
    onSettled: invalidate,
  })
}

export function useDeleteAccount(id: number) {
  const client = useQueryClient()
  const invalidate = useInvalidateAccounts()
  return useMutation({
    mutationFn: () => api(`/accounts/${id}`, { method: "DELETE" }),
    onError: (error) =>
      toast.error(`Couldn't delete the account: ${error.message}`),
    onSuccess: () => {
      client.removeQueries({ queryKey: ["accounts", id] })
      return Promise.all([
        invalidate(),
        client.invalidateQueries({ queryKey: ["transactions"] }),
      ])
    },
  })
}
