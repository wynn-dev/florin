import { z } from "zod"
import {
  createCategory,
  createCategoryGroup,
  deleteCategory,
  deleteCategoryGroup,
  listCategoryGroups,
  renameCategoryGroup,
  updateCategory,
} from "../../data"
import { InvalidInput } from "../../data/validate"
import { defineTool } from "../tool"
import { zId } from "./common"

export const listCategories = defineTool({
  name: "list_categories",
  title: "List categories",
  description:
    "Category groups with their categories and ids. Income groups hold the categories income is booked to (that money becomes 'to budget'); every other category is an expense envelope. Hidden categories are included and marked unless includeHidden is false.",
  input: { includeHidden: z.boolean().optional() },
  kind: "read",
  run: ({ includeHidden }) =>
    listCategoryGroups().map((g) => ({
      id: g.id,
      name: g.name,
      ...(g.isIncome ? { isIncome: true } : {}),
      categories: g.categories
        .filter((c) => includeHidden !== false || !c.hidden)
        .map((c) => ({
          id: c.id,
          name: c.name,
          ...(c.hidden ? { hidden: true } : {}),
        })),
    })),
})

export const saveCategory = defineTool({
  name: "save_category",
  title: "Create or change a category",
  description:
    "Without id: creates a category (name and groupId needed). With id: renames it, moves it to another group (groupId) or hides/shows it (hidden). Hide a category that is no longer used rather than deleting it.",
  input: {
    id: zId
      .optional()
      .describe("The category to change; leave out to create one"),
    name: z.string().optional(),
    groupId: zId.optional(),
    hidden: z.boolean().optional(),
  },
  kind: "write",
  run: ({ id, name, groupId, hidden }, { actor }) => {
    if (id !== undefined)
      return updateCategory(actor(), id, { name, groupId, hidden })
    if (!name || groupId === undefined)
      throw new InvalidInput("a new category needs a name and a groupId")
    const created = createCategory(actor(), { groupId, name })
    return hidden ? updateCategory(actor(), created.id, { hidden }) : created
  },
})

export const saveCategoryGroup = defineTool({
  name: "save_category_group",
  title: "Create or rename a category group",
  description:
    "Without id: creates a group (isIncome: true for a group of income categories). With id: renames it.",
  input: {
    id: zId.optional().describe("The group to rename; leave out to create one"),
    name: z.string(),
    isIncome: z.boolean().optional().describe("Only when creating"),
  },
  kind: "write",
  run: ({ id, name, isIncome }, { actor }) => {
    if (id === undefined)
      return createCategoryGroup(actor(), { name, isIncome })
    if (isIncome !== undefined)
      throw new InvalidInput("a group's isIncome is set when it is created")
    return renameCategoryGroup(actor(), id, name)
  },
})

export const deleteCategoryTool = defineTool({
  name: "delete_category",
  title: "Delete a category or group",
  description:
    "Deletes one category (categoryId) or a whole group with its categories (groupId). With moveTo, their transactions and budgeted amounts move to that category first, so nothing becomes uncategorized and the money stays assigned; without it, their transactions become uncategorized and their budget amounts return to 'to budget'.",
  input: {
    categoryId: zId.optional(),
    groupId: zId.optional(),
    moveTo: zId
      .optional()
      .describe("The category that takes over their transactions and budgets"),
  },
  kind: "destructive",
  run: ({ categoryId, groupId, moveTo }, { actor }) => {
    if ((categoryId === undefined) === (groupId === undefined))
      throw new InvalidInput("give either categoryId or groupId")
    if (categoryId !== undefined) deleteCategory(actor(), categoryId, moveTo)
    else deleteCategoryGroup(actor(), groupId!, moveTo)
    return { deleted: categoryId !== undefined ? { categoryId } : { groupId } }
  },
})
