import { z } from "zod"
import {
  coverOverspending,
  getBudgetMonth,
  getSettings,
  moveBudgetAmounts,
  setBudgetAmounts,
  setMonthlyGoal,
} from "../../data"
import { today } from "../../data/validate"
import { defineTool } from "../tool"
import { zAmount, zId, zMonth } from "./common"
import type { BudgetMonth } from "@/shared/types"

/** A budget month without hidden or (optionally) empty categories. */
function compactMonth(
  m: BudgetMonth,
  options: { includeHidden?: boolean; onlyActive?: boolean } = {}
) {
  return {
    currency: getSettings().currency,
    month: m.month,
    income: m.income,
    budgeted: m.budgeted,
    activity: m.activity,
    available: m.available,
    overspent: m.overspent,
    lastMonthOverspent: m.lastMonthOverspent,
    toBudget: m.toBudget,
    goal: m.goal,
    groups: m.groups.map((g) => ({
      id: g.id,
      name: g.name,
      budgeted: g.budgeted,
      activity: g.activity,
      available: g.available,
      categories: g.categories
        .filter((c) => options.includeHidden || !c.hidden || c.available !== 0)
        .filter(
          (c) =>
            !options.onlyActive ||
            c.budgeted !== 0 ||
            c.activity !== 0 ||
            c.available !== 0
        )
        .map((c) => ({
          id: c.id,
          name: c.name,
          budgeted: c.budgeted,
          activity: c.activity,
          available: c.available,
          ...(c.hidden ? { hidden: true } : {}),
          ...(c.outsideGoal ? { outsideGoal: true } : {}),
        })),
    })),
  }
}

export const getBudgetMonthTool = defineTool({
  name: "get_budget_month",
  title: "Read a budget month",
  description:
    "The envelope budget for a month (default this month), in the budget's currency as integer minor units. Per category: budgeted (assigned this month), activity (this month's transactions, spending negative) and available (last month's available if positive + budgeted + activity: leftover carries over, overspending does not; negative = overspent this month). overspent is the month's total overspending; at month end it resets to zero in each category and comes out of the next month's toBudget instead (lastMonthOverspent is what the month before took). toBudget is all income to date minus all assigned to date minus every earlier month's overspending; negative means more is assigned than has come in. To keep an overspent category from lowering next month's toBudget, cover it this month with move_money or cover_overspending. The dashboard speaks plain words, and so should you when telling the person: budgeted is shown as Planned, activity as Spent (positive), available as Left (a negative one as '€X over'), toBudget as 'not planned yet', income as 'Money in', the carried-in leftover as 'Left from last month', lastMonthOverspent as 'Went over last month' and overspent as 'Over plan'. goal is the monthly spending goal against this month, null when none is set: amount, spent (this month's spending as the spending report counts it, without categories marked outsideGoal), left (amount − spent; negative = over the goal by that much) and planned (budgeted in the categories the goal counts); shown first on the dashboard as '€X spent of €Y' and '€X left' or '€X over your €Y goal'. Hidden categories show only when they hold money unless includeHidden; onlyActive leaves out categories that are all zero. Example: Groceries budgeted 40000, activity -45000 → available -5000, overspent 5000; next month it starts at 0 and toBudget is 5000 lower.",
  input: {
    month: zMonth.optional(),
    includeHidden: z.boolean().optional(),
    onlyActive: z.boolean().optional(),
  },
  kind: "read",
  run: ({ month, ...options }) =>
    compactMonth(getBudgetMonth(month ?? today().slice(0, 7)), options),
})

const summary = (m: BudgetMonth) => ({
  currency: getSettings().currency,
  month: m.month,
  budgeted: m.budgeted,
  overspent: m.overspent,
  toBudget: m.toBudget,
})

export const setBudget = defineTool({
  name: "set_budget",
  title: "Set budget amounts",
  description:
    "Sets what is assigned to expense categories in a month (shown as Planned on the dashboard), many in one call, all or none. Each amount replaces the category's assigned amount for that month (0 clears it); it is integer minor units in the budget's currency. To shift money from one envelope to another without touching 'to budget', use move_money. Assigning in a month changes toBudget ('not planned yet') for that month and every later one. Returns the month's budgeted, overspent and toBudget; read get_budget_month for per-category detail.",
  input: {
    month: zMonth,
    amounts: z
      .array(
        z.object({
          categoryId: zId,
          amount: zAmount.describe("Integer minor units, usually positive"),
        })
      )
      .min(1)
      .max(500),
  },
  kind: "write",
  idempotent: true,
  run: ({ month, amounts }, { actor }) =>
    summary(setBudgetAmounts(actor(), month, amounts)),
})

export const moveMoney = defineTool({
  name: "move_money",
  title: "Move money between categories",
  description:
    "Moves budgeted money between expense categories in a month, e.g. to cover an overspent category from one with money left (covered within its month, overspending never reaches the next month's toBudget): each move lowers fromCategoryId's assigned amount and raises toCategoryId's by amount (positive integer minor units). 'To budget' is unchanged, except that null on either side is 'to budget' itself (Ready to assign): from null assigns more to toCategoryId, to null gives money back. On the dashboard budgeted is Planned, available is Left and toBudget is 'not planned yet'. Several moves in one call, all or none. Returns the month's totals and the affected categories' new numbers. Example: cover Groceries (available -5000) from Dining out: { fromCategoryId: <Dining out>, toCategoryId: <Groceries>, amount: 5000 }.",
  input: {
    month: zMonth,
    moves: z
      .array(
        z.object({
          fromCategoryId: zId.nullable(),
          toCategoryId: zId.nullable(),
          amount: z.number().int().positive(),
        })
      )
      .min(1)
      .max(100),
  },
  kind: "write",
  run: ({ month, moves }, { actor }) => {
    const m = moveBudgetAmounts(actor(), month, moves)
    const touched = new Set(
      moves.flatMap((x) => [x.fromCategoryId, x.toCategoryId])
    )
    return {
      ...summary(m),
      categories: m.groups
        .flatMap((g) => g.categories)
        .filter((c) => touched.has(c.id))
        .map((c) => ({
          id: c.id,
          name: c.name,
          budgeted: c.budgeted,
          activity: c.activity,
          available: c.available,
        })),
    }
  },
})

export const coverOverspendingTool = defineTool({
  name: "cover_overspending",
  title: "Cover a month's overspending",
  description:
    "Covers every overspent category in a month (available below zero; 'over' on the dashboard) from toBudget ('not planned yet'): raises each one's budgeted (Planned) by what it is over, so its available (Left) is 0 and nothing comes out of next month's toBudget. All or none, one Activity entry. Fails, changing nothing, when nothing is overspent or when toBudget is less than the total overspending (the error says by how much); then cover the rest with move_money from categories with money left. Returns the month's totals and each category covered with the amount added. To undo, move_money each amount back from the category to null.",
  input: { month: zMonth },
  kind: "write",
  run: ({ month }, { actor }) => {
    const { month: m, covered } = coverOverspending(actor(), month)
    return { ...summary(m), covered }
  },
})

export const setMonthlyGoalTool = defineTool({
  name: "set_monthly_goal",
  title: "Set the monthly spending goal",
  description:
    "Sets the one monthly spending goal for the budget (\"spend under X a month\"), in integer minor units of the budget's currency, or removes it with null. It is a target only: it changes no budget numbers and blocks nothing. Each month's spending toward it is what the spending report counts (on-budget, net of refunds, never transfers between own accounts) without categories marked outsideGoal (save_category). Read it back as goal in get_budget_month or overview.",
  input: {
    amount: zAmount
      .nullable()
      .describe("Integer minor units, more than zero; null removes the goal"),
  },
  kind: "write",
  idempotent: true,
  run: ({ amount }, { actor }) => {
    setMonthlyGoal(actor(), amount)
    return {
      currency: getSettings().currency,
      goal: getBudgetMonth(today().slice(0, 7)).goal,
    }
  },
})
