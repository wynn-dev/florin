import { z } from "zod"
import {
  cashFlow,
  getSettings,
  incomeVsExpenses,
  listAccounts,
  listAccountValues,
  listActivity,
  listFxRates,
  listHoldings,
  netWorth,
  resolveRange,
  spendingByCategory,
} from "../../data"
import { InvalidInput } from "../../data/validate"
import { defineTool } from "../tool"
import { page, zDate, zId, zLimit, zOffset } from "./common"

const REPORTS = {
  net_worth: netWorth,
  spending: spendingByCategory,
  income_expenses: incomeVsExpenses,
  cash_flow: cashFlow,
}

export const getReport = defineTool({
  name: "get_report",
  title: "Read a report",
  description:
    "A report over a date range (default the last twelve months), in the budget's currency as integer minor units. net_worth: assets, debts and net worth at each month end, accounts in other currencies converted at that date's rate. spending: money spent per expense category over the range, largest first, as positive numbers. income_expenses: income and expenses (positive) per month. cash_flow: money in, money out (positive) and net per month. All but net_worth count on-budget accounts only, and leave out opening balances and transfers between on-budget accounts.",
  input: {
    report: z.enum(["net_worth", "spending", "income_expenses", "cash_flow"]),
    from: zDate.optional(),
    to: zDate.optional(),
  },
  kind: "read",
  run: ({ report, from, to }) => {
    const range = resolveRange({ from, to })
    return {
      currency: getSettings().currency,
      report,
      ...range,
      rows: REPORTS[report](range),
    }
  },
})

export const getInvestments = defineTool({
  name: "get_investments",
  title: "Read investments",
  description:
    "Investment accounts (or one, by accountId) with their current holdings and their value over time, in the account's own currency as integer minor units (a holding's price is per unit in the holding's currency, as a decimal). Value history defaults to the last twelve months; from/to narrow it. valueIn<budget currency> is the latest value converted at today's rate.",
  input: {
    accountId: zId.optional(),
    from: zDate.optional(),
    to: zDate.optional(),
  },
  kind: "read",
  run: ({ accountId, from, to }) => {
    const { currency } = getSettings()
    const range = resolveRange({ from, to })
    const accounts = listAccounts().filter((a) =>
      accountId === undefined
        ? a.type === "investment" || listHoldings(a.id).length > 0
        : a.id === accountId
    )
    if (accountId !== undefined && !accounts.length)
      throw new InvalidInput(`there is no account ${accountId}`)
    return accounts.map((a) => ({
      accountId: a.id,
      name: a.name,
      currency: a.currency,
      value: a.balance,
      ...(a.currency !== currency
        ? { [`valueIn${currency}`]: a.budgetBalance }
        : {}),
      holdings: listHoldings(a.id),
      values: listAccountValues(a.id).filter(
        (v) => v.date >= range.from && v.date <= range.to
      ),
    }))
  },
})

export const getExchangeRates = defineTool({
  name: "get_exchange_rates",
  title: "Read exchange rates",
  description:
    "ECB reference rates florin uses to convert accounts in other currencies, as units of the currency per 1 EUR. Without currency: the latest rate of each currency. With currency: its rates over from/to, newest first.",
  input: {
    currency: z.string().optional().describe("ISO 4217, e.g. USD"),
    from: zDate.optional(),
    to: zDate.optional(),
    limit: zLimit(100, 1000),
  },
  kind: "read",
  run: (input) => ({ base: "EUR", rates: listFxRates(input) }),
})

export const getActivity = defineTool({
  name: "get_activity",
  title: "Read the change log",
  description:
    "Who changed what, newest first: every write records its actor (person = the dashboard, mcp:<name> = an MCP client, bank-sync, import, demo) and a one-line summary. actor filters to one actor; 'mcp:' matches every MCP client. Paged.",
  input: {
    actor: z.string().optional(),
    limit: zLimit(50, 500),
    offset: zOffset,
  },
  kind: "read",
  run: ({ actor, limit = 50, offset = 0 }) => {
    const result = listActivity({ actor, limit, offset })
    return page(
      result.items.map((c) => ({
        at: c.at,
        actor: c.actor,
        action: c.action,
        entity: c.entity,
        ...(c.entityId !== null ? { entityId: c.entityId } : {}),
        summary: c.summary,
      })),
      result.total,
      offset
    )
  },
})
