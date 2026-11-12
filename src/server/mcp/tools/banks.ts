import { listBankLinks, syncAll, syncLink } from "../../enablebanking"
import { secretInfo } from "../../secrets"
import { defineTool } from "../tool"
import { zId } from "./common"

export const listBankLinksTool = defineTool({
  name: "list_bank_links",
  title: "List bank links",
  description:
    "The banks linked through Enable Banking: each link's state (active, expiring within 14 days, expired, revoked), when access ends, the last sync and its error, and which florin account each bank account feeds. Only the person can link a bank or renew access, in the dashboard.",
  input: {},
  kind: "read",
  run: () => {
    if (!secretInfo("enablebanking.appId").set)
      return {
        links: [],
        note: "Enable Banking isn't set up; the person adds it in Settings › Connections.",
      }
    return {
      links: listBankLinks().map((l) => ({
        id: l.id,
        bank: l.bank,
        state: l.state,
        accessUntil: l.validUntil.slice(0, 10),
        daysLeft: l.daysLeft,
        lastSyncAt: l.lastSyncAt,
        lastError: l.lastError,
        syncing: l.syncing,
        accounts: l.accounts.map((a) => ({
          bankAccount: [a.name, a.identifier].filter(Boolean).join(" "),
          currency: a.currency,
          accountId: a.accountId,
          account: a.accountName,
        })),
      })),
    }
  },
})

export const syncBanks = defineTool({
  name: "sync_banks",
  title: "Sync banks now",
  description:
    "Fetches new transactions from the bank now, for one link (linkId from list_bank_links) or every active one, and answers how many were added, updated (pending ones booked) and removed. Banks allow only a few unattended fetches a day; one refused this way says so in error and florin retries at the next scheduled sync.",
  input: { linkId: zId.optional() },
  kind: "write",
  run: ({ linkId }) => (linkId ? syncLink(linkId) : syncAll()),
})
