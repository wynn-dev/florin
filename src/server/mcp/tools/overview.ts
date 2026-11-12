import {
  getBudgetMonth,
  getSettings,
  listAccounts,
  listActivity,
  listTransactions,
} from "../../data"
import { today } from "../../data/validate"
import { defineTool } from "../tool"
import { compactAccount } from "./common"
import type { Account } from "@/shared/types"

function leftOut(accounts: Account[]) {
  const missing = accounts.filter(
    (a) => a.budgetBalance === null && a.balance !== 0
  )
  return missing.length
    ? {
        netWorthLeavesOut: missing.map((a) => ({
          id: a.id,
          name: a.name,
          currency: a.currency,
          balance: a.balance,
        })),
        netWorthNote:
          "netWorth leaves these accounts out: no exchange rate to the budget currency is stored yet. florin fetches ECB rates in the background; check get_exchange_rates later.",
      }
    : {}
}

export const overview = defineTool({
  name: "overview",
  title: "Overview",
  description:
    "Start here. The lay of the land in one call: the budget's currency and settings, today's date, open accounts with balances, net worth (netWorthLeavesOut lists accounts in another currency left out of it because no exchange rate is stored yet), this month's budget (income, budgeted, activity, available, overspent, toBudget, and goal: the monthly spending goal with spent and left this month, null when none is set; see set_monthly_goal), overspent categories (covered this month with cover_overspending or move_money, or their overspending comes out of next month's toBudget; the dashboard calls budgeted Planned, available Left and toBudget 'not planned yet'), how many transactions need a category or are still pending, and the last few changes. Amounts are integer minor units; negative = money out.",
  input: {},
  kind: "read",
  run: () => {
    const settings = getSettings()
    const { currency } = settings
    const date = today()
    const month = date.slice(0, 7)
    const accounts = listAccounts()
    const budget = getBudgetMonth(month)
    return {
      currency,
      settings,
      today: date,
      accounts: accounts
        .filter((a) => !a.closed)
        .map((a) => compactAccount(a, currency)),
      closedAccounts: accounts.filter((a) => a.closed).length,
      netWorth: accounts.reduce((sum, a) => sum + (a.budgetBalance ?? 0), 0),
      // A foreign account with no ECB rate yet can't be converted: say so
      // rather than give an incomplete figure as if it were whole.
      ...leftOut(accounts),
      budget: {
        month,
        income: budget.income,
        budgeted: budget.budgeted,
        activity: budget.activity,
        available: budget.available,
        overspent: budget.overspent,
        toBudget: budget.toBudget,
        goal: budget.goal,
      },
      overspent: budget.groups.flatMap((g) =>
        g.categories
          .filter((c) => c.available < 0)
          .map((c) => ({
            categoryId: c.id,
            name: c.name,
            available: c.available,
          }))
      ),
      uncategorized: listTransactions({ uncategorized: true, limit: 1 }).total,
      pending: listTransactions({ status: "pending", limit: 1 }).total,
      recentChanges: listActivity({ limit: 5 }).items.map((c) => ({
        at: c.at,
        actor: c.actor,
        summary: c.summary,
      })),
    }
  },
})
