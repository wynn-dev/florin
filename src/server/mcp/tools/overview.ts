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

export const overview = defineTool({
  name: "overview",
  title: "Overview",
  description:
    "Start here. The lay of the land in one call: the budget's currency and settings, today's date, open accounts with balances, net worth, this month's budget (income, budgeted, activity, available, toBudget), overspent categories, how many transactions need a category or are still pending, and the last few changes. Amounts are integer minor units; negative = money out.",
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
      budget: {
        month,
        income: budget.income,
        budgeted: budget.budgeted,
        activity: budget.activity,
        available: budget.available,
        toBudget: budget.toBudget,
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
