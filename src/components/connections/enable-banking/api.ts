// The dashboard's side of /api/connections/enable-banking: query options and
// the calls the bank sync pieces make. Other parts of the dashboard (the
// sidebar's sync line, Needs attention) read the same query.
import { queryOptions } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type {
  AccountMapping,
  Bank,
  BankLink,
  EnableBankingStatus,
  SetCredentials,
  SyncHours,
  SyncResult,
} from "@/shared/enablebanking"

const BASE = "/connections/enable-banking"

export const ebQueries = {
  status: () =>
    queryOptions({
      queryKey: ["enable-banking"],
      queryFn: () => api<EnableBankingStatus>(BASE),
    }),
  /** The links alone, without asking Enable Banking: for account pages and lists. */
  links: () =>
    queryOptions({
      queryKey: ["enable-banking", "links"],
      queryFn: () => api<BankLink[]>(`${BASE}/links`),
      // While a sync runs (scheduled, or started elsewhere), watch it finish.
      refetchInterval: (query) =>
        query.state.data?.some((l) => l.syncing) ? 2_000 : false,
    }),
  banks: (country: string) =>
    queryOptions({
      queryKey: ["enable-banking", "banks", country],
      queryFn: () => api<Bank[]>(`${BASE}/banks?country=${country}`),
      staleTime: 60 * 60_000,
    }),
}

export const setCredentials = (input: SetCredentials) =>
  api<EnableBankingStatus>(`${BASE}/credentials`, {
    method: "PUT",
    body: input,
  })

export const setSyncHours = (hours: SyncHours) =>
  api<EnableBankingStatus>(`${BASE}/interval`, {
    method: "PUT",
    body: { hours },
  })

/**
 * The page to come back to after the bank: where the person is now, query
 * included (setup's ?step=2), without a previous return's link params.
 */
const here = () => {
  const url = new URL(window.location.href)
  for (const p of ["link", "linkError", "linked"]) url.searchParams.delete(p)
  return url.pathname + url.search
}

/** Starts linking a bank and sends the browser to it. */
export async function startLink(
  country: string,
  bank: string,
  returnTo = here()
): Promise<void> {
  const { url } = await api<{ url: string }>(`${BASE}/links`, {
    method: "POST",
    body: { country, bank, returnTo },
  })
  window.location.href = url
}

/** Renews a link's access at the bank: sends the browser there and back to `returnTo`. */
export async function renewLink(
  linkId: number,
  returnTo = here()
): Promise<void> {
  const { url } = await api<{ url: string }>(`${BASE}/links/${linkId}/renew`, {
    method: "POST",
    body: { returnTo },
  })
  window.location.href = url
}

export const mapAccounts = (linkId: number, accounts: AccountMapping[]) =>
  api<SyncResult>(`${BASE}/links/${linkId}/accounts`, {
    method: "POST",
    body: { accounts },
  })

export const syncLink = (linkId: number) =>
  api<SyncResult>(`${BASE}/links/${linkId}/sync`, { method: "POST" })

export const syncAllBanks = () =>
  api<SyncResult>(`${BASE}/sync`, { method: "POST" })

export const disconnectLink = (linkId: number) =>
  api<void>(`${BASE}/links/${linkId}`, { method: "DELETE" })

/** "Added 12 transactions", for a toast after a sync the person started. */
export function describeSync(result: SyncResult): string {
  const parts = [
    result.added && `added ${result.added}`,
    result.updated && `updated ${result.updated}`,
    result.removed && `removed ${result.removed} pending`,
    result.matched && `matched ${result.matched}`,
  ].filter(Boolean)
  if (!parts.length) return "No new transactions"
  const text = parts.join(", ")
  return (
    text[0].toUpperCase() +
    text.slice(1) +
    (result.added + result.updated + result.matched === 1
      ? " transaction"
      : " transactions")
  )
}
