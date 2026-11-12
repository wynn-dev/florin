import { z } from "zod"
import { applyRules, deleteRules, listRules, saveRules } from "../../data"
import { defineTool } from "../tool"
import { zDate, zId } from "./common"
import type { Rule } from "@/shared/types"

/** A rule in a few fields, empty ones left out. */
function compactRule(r: Rule) {
  return {
    id: r.id,
    position: r.position,
    pattern: r.pattern,
    ...(r.payee ? { payee: r.payee } : {}),
    ...(r.categoryId
      ? { categoryId: r.categoryId, category: r.categoryName }
      : {}),
  }
}

export const listRulesTool = defineTool({
  name: "list_rules",
  title: "List rules",
  description:
    "The rules that name and categorise transactions from the bank's text, in the order they run. Each has a pattern (a case-insensitive JavaScript regular expression) and sets a payee, a category or both.",
  input: {},
  kind: "read",
  run: () => ({ rules: listRules().map(compactRule) }),
})

export const saveRulesTool = defineTool({
  name: "save_rules",
  title: "Create or change rules",
  description:
    "Creates rules (no id) and changes them (id; only the fields given change), up to 500 in one call, all or none. Rules run top to bottom on every imported row (bank sync, CSV, import_transactions): a rule matches when its pattern is found in the bank's text, the notes, or the payee name as it stands (which an earlier rule may have set), and a later match overrides an earlier one; so put generic extraction rules first and name rules after them. payee may use $1…$9 for captured parts of the match. A category given with an imported row wins over the rules'; with no rule category, the payee's default category applies. New rules go last in the order given unless they have a position (from 1); a position given to an existing rule moves it. Example: [{pattern: '^BEA, [^,]*?Pay\\\\s+(.+?)\\\\s+NR:', payee: '$1'}, {pattern: 'albert heijn \\\\d|^ah \\\\d', payee: 'Albert Heijn', categoryId: 12}]. Existing transactions are not changed; run apply_rules for that. Returns every rule in order.",
  input: {
    rules: z
      .array(
        z.object({
          id: zId
            .optional()
            .describe("The rule to change; leave out to create one"),
          pattern: z
            .string()
            .max(500)
            .optional()
            .describe("JavaScript regular expression source, case-insensitive"),
          payee: z
            .string()
            .nullable()
            .optional()
            .describe("The payee name to set, $1…$9 for captures; null clears"),
          categoryId: zId.nullable().optional().describe("null clears"),
          position: z.number().int().min(1).optional(),
        })
      )
      .min(1)
      .max(500),
  },
  kind: "write",
  run: ({ rules }, { actor }) => ({
    rules: saveRules(actor(), rules).map(compactRule),
  }),
})

export const deleteRulesTool = defineTool({
  name: "delete_rules",
  title: "Delete rules",
  description:
    "Deletes rules by id, all or none. Transactions they already named or categorised stay as they are.",
  input: { ids: z.array(zId).min(1).max(500) },
  kind: "destructive",
  run: ({ ids }, { actor }) => {
    deleteRules(actor(), ids)
    return { deleted: ids.length }
  },
})

export const applyRulesTool = defineTool({
  name: "apply_rules",
  title: "Apply rules to existing transactions",
  description:
    "Runs the rules over existing transactions (transfers skipped): those with ids, or in accountId between from and to, or all. By default it only fills what is untouched: a category where there is none, and a payee where the transaction has none or still carries the bank's own name, so edits made by hand stay; overwrite: true sets both wherever a rule matches. dryRun: true answers the counts and a sample of up to 20 changes without writing. The run is one Activity entry, and payees it leaves with no transactions and no default category are deleted. Example: after save_rules, {dryRun: true} to check, then {} to apply.",
  input: {
    ids: z.array(zId).max(5000).optional(),
    accountId: zId.optional(),
    from: zDate.optional(),
    to: zDate.optional(),
    dryRun: z.boolean().optional(),
    overwrite: z.boolean().optional(),
  },
  kind: "write",
  run: (options, { actor }) => applyRules(actor(), options),
})
