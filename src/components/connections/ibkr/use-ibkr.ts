// The IBKR connection's query and mutations, shared by IbkrSettings and
// ConnectIbkrDialog. A pull changes accounts, values, holdings and
// transactions, so a finished one refreshes everything that shows them.
import { useEffect, useState } from "react"
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import type { IbkrCredentials, IbkrStatus } from "@/shared/ibkr"
import { api } from "@/lib/api"

export const ibkrStatusQuery = () =>
  queryOptions({
    queryKey: ["connections", "ibkr"],
    queryFn: () => api<IbkrStatus>("/connections/ibkr"),
    // While a pull runs (perhaps started by the schedule or an agent), watch it finish.
    refetchInterval: (query) => (query.state.data?.running ? 2_000 : false),
  })

export function useIbkrStatus() {
  return useQuery(ibkrStatusQuery())
}

function settled(client: QueryClient, status: IbkrStatus) {
  client.setQueryData(ibkrStatusQuery().queryKey, status)
  for (const key of [
    "accounts",
    "transactions",
    "reports",
    "account",
    "holdings",
    "values",
  ])
    void client.invalidateQueries({ queryKey: [key] })
}

export function usePullIbkr() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api<IbkrStatus>("/connections/ibkr/pull", { method: "POST" }),
    onSuccess: (status) => settled(client, status),
    onSettled: () =>
      client.invalidateQueries({ queryKey: ibkrStatusQuery().queryKey }),
  })
}

export function useSaveIbkr() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (credentials: IbkrCredentials) =>
      api<IbkrStatus>("/connections/ibkr", {
        method: "PUT",
        body: credentials,
      }),
    onSuccess: (status) => settled(client, status),
    onSettled: () =>
      client.invalidateQueries({ queryKey: ibkrStatusQuery().queryKey }),
  })
}

export function useDisconnectIbkr() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api<IbkrStatus>("/connections/ibkr", { method: "DELETE" }),
    onSuccess: (status) =>
      client.setQueryData(ibkrStatusQuery().queryKey, status),
  })
}

/** Whether `iso` is still in the future; re-renders once it passes, so a "next pull allowed at" clears itself. */
export function useUntil(iso: string | null | undefined): boolean {
  const [, tick] = useState(0)
  const waiting = Boolean(iso && Date.parse(iso) > Date.now())
  useEffect(() => {
    if (!iso) return
    const ms = Date.parse(iso) - Date.now()
    if (ms <= 0) return
    const timer = setTimeout(() => tick((n) => n + 1), ms + 50)
    return () => clearTimeout(timer)
  }, [iso])
  return waiting
}
