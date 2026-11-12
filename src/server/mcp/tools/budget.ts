import { z } from "zod"
import {
  getBudgetMonth,
  getSettings,
  moveBudgetAmounts,
  setBudgetAmounts,
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
        })),
    })),
  }
}

export const getBudgetMonthTool = defineTool({
  name: "get_budget_month",
  title: "Read a budget month",
  description:
    "The envelope budget for a month (default this month), in the budget's currency as integer minor units. Per category: budgeted (assigned this month), activity (this month's transactions, spending negative) and available (last month's available if positive + budgeted + activity: leftover carries over, overspending does not; negative = overspent this month). overspent is the month's total overspending; at month end it resets to zero in each category and comes out of the next month's toBudget instead (lastMonthOverspent is what the month before took). toBudget (Ready to assign) is all income to date minus all assigned to date minus every earlier month's overspending; negative means more is assigned than has come in. To keep an overspent category from lowering next month's toBudget, cover it this month with move_money. Hidden categories show only when they hold money unless includeHidden; onlyActive leaves out categories that are all zero. Example: Groceries budgeted 40000, activity -45000 → available -5000, overspent 5000; next month it starts at 0 and toBudget is 5000 lower.",
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
    "Sets what is assigned to expense categories in a month, many in one call, all or none. Each amount replaces the category's assigned amount for that month (0 clears it); it is integer minor units in the budget's currency. To shift money from one envelope to another without touching 'to budget', use move_money. Assigning in a month changes toBudget for that month and every later one. Returns the month's budgeted, overspent and toBudget; read get_budget_month for per-category detail.",
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
    "Moves budgeted money between expense categories in a month, e.g. to cover an overspent category from one with money left (covered within its month, overspending never reaches the next month's toBudget): each move lowers fromCategoryId's assigned amount and raises toCategoryId's by amount (positive integer minor units). 'To budget' is unchanged, except that null on either side is 'to budget' itself (Ready to assign): from null assigns more to toCategoryId, to null gives money back. Several moves in one call, all or none. Returns the month's totals and the affected categories' new numbers. Example: cover Groceries (available -5000) from Dining out: { fromCategoryId: <Dining out>, toCategoryId: <Groceries>, amount: 5000 }.",
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
