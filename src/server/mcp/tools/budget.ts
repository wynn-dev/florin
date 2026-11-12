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
    "The envelope budget for a month (default this month), in the budget's currency as integer minor units. Per category: budgeted (assigned this month), activity (this month's transactions, spending negative) and available (everything assigned to date plus all activity to date, so leftovers and overspending carry over; negative = overspent). toBudget is all income to date minus all assigned to date; negative means more is assigned than has come in. Hidden categories show only when they hold money unless includeHidden; onlyActive leaves out categories that are all zero.",
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
  toBudget: m.toBudget,
})

export const setBudget = defineTool({
  name: "set_budget",
  title: "Set budget amounts",
  description:
    "Sets what is assigned to expense categories in a month, many in one call, all or none. Each amount replaces the category's assigned amount for that month (0 clears it); it is integer minor units in the budget's currency. To shift money from one envelope to another without touching 'to budget', use move_money. Returns the month's totals and toBudget; read get_budget_month for per-category detail.",
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
    "Moves budgeted money between expense categories in a month, e.g. to cover an overspent category from one with money left: each move lowers fromCategoryId's assigned amount and raises toCategoryId's by amount (positive integer minor units). 'To budget' is unchanged. Several moves in one call, all or none. Returns the affected categories' new numbers.",
  input: {
    month: zMonth,
    moves: z
      .array(
        z.object({
          fromCategoryId: zId,
          toCategoryId: zId,
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
