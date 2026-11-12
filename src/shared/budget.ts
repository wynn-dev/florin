// Budget types beyond the month itself (types.ts has BudgetMonth).
import type { Actor } from "./types"

/** One category around a month, for the budget's inspector and phone drawer. */
export type BudgetCategoryDetail = {
  categoryId: number
  /** The twelve months up to and including the month, oldest first; spent is positive for spending. */
  history: { month: string; spent: number }[]
  /** The latest change to the category's budget, by anyone; null when there is none. */
  lastChange: { id: number; at: string; actor: Actor; summary: string } | null
}
