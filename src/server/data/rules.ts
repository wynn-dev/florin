// Rules: one ordered list that names and categorises transactions from the
// bank's text, and makes moves between the person's own accounts transfers.
// importTransactions and the broker sync run them on every new row (bank
// sync, CSV and MCP imports alike); applyRules runs them over existing
// transactions.
import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import { db, schema } from "../db"
import { getAccount } from "./accounts"
import { getCategory } from "./categories"
import { inBatch, logChange } from "./changes"
import { convert } from "./fx"
import { cleanPayee } from "./importing"
import {
  eachItem,
  getTransaction,
  makeTransfer,
  patchTransactions,
} from "./transactions"
import {
  MAX_DAYS,
  addDays,
  findMirror,
  isPossibleLeg,
  linkPair,
} from "./transfers"
import {
  checkDate,
  checkList,
  checkObject,
  found,
  InvalidInput,
} from "./validate"
import type { Database } from "../db"
import type {
  Actor,
  ApplyRulesOptions,
  ApplyRulesResult,
  Rule,
  RuleChange,
  RuleInput,
  RuleTest,
} from "@/shared/types"

const { rules, categories, transactions, payees, changes, accounts } = schema
const transferAccount = alias(accounts, "transfer_account")

const MAX_PATTERN = 500
const MAX_RULES_PER_SAVE = 500

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0]

/** A rule ready to run: its pattern compiled. */
export type CompiledRule = {
  regex: RegExp
  payee: string | null
  categoryId: number | null
  /** Null too when the account is closed. */
  transferAccountId: number | null
}

/**
 * The texts a rule is tested on, the payee name the row starts with, and
 * the account it is in.
 */
export type RuleSubject = {
  bankText: string | null
  notes: string
  payee: string | null
  accountId: number
}

/**
 * Runs a row through the rules, top to bottom. A rule matches when its
 * pattern is found in the bank's text, the notes or the payee name as it
 * stands (which an earlier rule may have set); the first of those that
 * matches supplies $1…$9. A later match overrides an earlier one; a
 * transfer account that is the row's own is passed over. `names` is every
 * payee name the row carried on the way, the first one included.
 */
export function runRules(
  list: CompiledRule[],
  row: RuleSubject
): {
  payee: string | null
  categoryId: number | null
  transferAccountId: number | null
  matched: boolean
  names: string[]
} {
  let payee = row.payee
  let categoryId: number | null = null
  let transferAccountId: number | null = null
  let matched = false
  const names = payee ? [payee] : []
  for (const rule of list) {
    const match = firstMatch(rule.regex, [row.bankText, row.notes, payee])
    if (!match) continue
    matched = true
    if (rule.payee) payee = fill(rule.payee, match) || payee
    if (payee && payee !== names.at(-1)) names.push(payee)
    if (rule.categoryId !== null) categoryId = rule.categoryId
    if (
      rule.transferAccountId !== null &&
      rule.transferAccountId !== row.accountId
    )
      transferAccountId = rule.transferAccountId
  }
  return { payee, categoryId, transferAccountId, matched, names }
}

function firstMatch(
  regex: RegExp,
  texts: (string | null)[]
): RegExpExecArray | null {
  for (const text of texts) {
    const match = text ? regex.exec(text) : null
    if (match) return match
  }
  return null
}

/**
 * "$1" → the match's first captured part, tidied as a bank's name is
 * ("CORNER SHOP 12" → "Corner Shop 12"); text typed into the rule stays as
 * typed. The result trimmed, spaces collapsed.
 */
function fill(template: string, match: RegExpExecArray): string {
  return template
    .replace(/\$([1-9])/g, (_, n: string) => cleanPayee(match[Number(n)] ?? ""))
    .replace(/\s+/g, " ")
    .trim()
}

function compile(pattern: unknown, what: string): RegExp {
  if (typeof pattern !== "string" || !pattern)
    throw new InvalidInput(`${what} needs a pattern`)
  if (pattern.length > MAX_PATTERN)
    throw new InvalidInput(
      `${what}: the pattern is longer than ${MAX_PATTERN} characters`
    )
  try {
    return new RegExp(pattern, "i")
  } catch (error) {
    // "Invalid regular expression: /(/i: Unterminated group" → "Unterminated group"
    const reason = (error as Error).message.replace(/^.*: /, "")
    throw new InvalidInput(
      `${what} has a pattern that is not a valid regular expression (${reason})`
    )
  }
}

function checkPayee(value: unknown, what: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "string")
    throw new InvalidInput(`${what}: payee must be text`)
  const payee = value.replace(/\s+/g, " ").trim()
  if (payee.length > 200)
    throw new InvalidInput(`${what}: payee is longer than 200 characters`)
  return payee || null
}

/** The rules in order, ready to run. */
export function loadRules(tx: Pick<Database, "select"> = db()): CompiledRule[] {
  return tx
    .select({
      pattern: rules.pattern,
      payee: rules.payee,
      categoryId: rules.categoryId,
      transferAccountId: sql<
        number | null
      >`case when ${accounts.closed} then null else ${accounts.id} end`,
    })
    .from(rules)
    .leftJoin(accounts, eq(rules.transferAccountId, accounts.id))
    .orderBy(asc(rules.sortOrder), asc(rules.id))
    .all()
    .map((r) => ({ ...r, regex: new RegExp(r.pattern, "i") }))
}

/** Every rule, in the order they run. */
export function listRules(tx: Pick<Database, "select"> = db()): Rule[] {
  return tx
    .select({
      id: rules.id,
      pattern: rules.pattern,
      payee: rules.payee,
      categoryId: rules.categoryId,
      categoryName: categories.name,
      transferAccountId: rules.transferAccountId,
      transferAccountName: transferAccount.name,
    })
    .from(rules)
    .leftJoin(categories, eq(rules.categoryId, categories.id))
    .leftJoin(transferAccount, eq(rules.transferAccountId, transferAccount.id))
    .orderBy(asc(rules.sortOrder), asc(rules.id))
    .all()
    .map((r, i) => ({ ...r, position: i + 1 }))
}

/** "/^ah \d/ → Albert Heijn · Groceries" for change summaries. */
function describeRule(rule: {
  pattern: string
  payee: string | null
  categoryName: string | null
  transferAccountName: string | null
}): string {
  const sets = [
    rule.payee,
    rule.categoryName,
    rule.transferAccountName && `transfer to ${rule.transferAccountName}`,
  ]
    .filter(Boolean)
    .join(" · ")
  return `/${rule.pattern}/ → ${sets}`
}

/**
 * Creates and changes rules, all of them or none. New rules go last, in the
 * order given, unless they have a position; a position given to an existing
 * rule moves it. Positions apply in the order given.
 */
export function saveRules(actor: Actor, inputs: RuleInput[]): Rule[] {
  checkList(inputs, "rules")
  if (inputs.length > MAX_RULES_PER_SAVE)
    throw new InvalidInput(`save at most ${MAX_RULES_PER_SAVE} rules at a time`)
  db().transaction((tx) => {
    const current = new Map(listRules(tx).map((r) => [r.id, r]))
    const order = [...current.keys()]
    inputs.forEach((input, i) =>
      eachItem(inputs.length, i, () =>
        saveRule(tx, actor, checkObject(input, "each rule"), current, order)
      )
    )
    order.forEach((id, i) =>
      tx
        .update(rules)
        .set({ sortOrder: i + 1 })
        .where(and(eq(rules.id, id), sql`${rules.sortOrder} != ${i + 1}`))
        .run()
    )
  })
  return listRules()
}

function saveRule(
  tx: Tx,
  actor: Actor,
  input: RuleInput,
  current: Map<number, Rule>,
  order: number[]
) {
  const position =
    input.position === undefined ? undefined : checkPosition(input.position)
  const existing =
    input.id === undefined
      ? undefined
      : found(current.get(input.id), `rule ${input.id}`)
  const what = existing
    ? `rule ${existing.id} (/${existing.pattern}/)`
    : `rule /${String(input.pattern ?? "")}/`
  const pattern =
    input.pattern === undefined && existing
      ? existing.pattern
      : (compile(input.pattern, what), input.pattern as string)
  const payee =
    input.payee === undefined
      ? (existing?.payee ?? null)
      : checkPayee(input.payee, what)
  const category =
    input.categoryId === undefined
      ? existing?.categoryId
        ? { id: existing.categoryId, name: existing.categoryName }
        : null
      : input.categoryId === null
        ? null
        : getCategory(input.categoryId)
  const transfer =
    input.transferAccountId === undefined
      ? existing?.transferAccountId
        ? {
            id: existing.transferAccountId,
            name: existing.transferAccountName,
          }
        : null
      : input.transferAccountId === null
        ? null
        : openAccount(input.transferAccountId, what)
  if (!payee && !category && !transfer)
    throw new InvalidInput(
      `${what} sets nothing: give it a payee, a categoryId, a transferAccountId or more`
    )
  const values = {
    pattern,
    payee,
    categoryId: category?.id ?? null,
    transferAccountId: transfer?.id ?? null,
  }
  const described = describeRule({
    pattern,
    payee,
    categoryName: category?.name ?? null,
    transferAccountName: transfer?.name ?? null,
  })

  if (!existing) {
    const { id } = tx
      .insert(rules)
      .values(values)
      .returning({ id: rules.id })
      .get()
    order.splice(
      position === undefined
        ? order.length
        : Math.min(position - 1, order.length),
      0,
      id
    )
    current.set(id, {
      id,
      position: 0,
      ...values,
      categoryName: null,
      transferAccountName: null,
    })
    logChange(tx, actor, {
      action: "create",
      entity: "rule",
      entityId: id,
      summary: `Added rule ${described}`,
    })
    return
  }

  const changed: string[] = []
  if (pattern !== existing.pattern) changed.push(`pattern → /${pattern}/`)
  if (payee !== existing.payee) changed.push(`payee → ${payee ?? "none"}`)
  if (values.categoryId !== existing.categoryId)
    changed.push(`category → ${category?.name ?? "none"}`)
  if (values.transferAccountId !== existing.transferAccountId)
    changed.push(`transfer to → ${transfer?.name ?? "none"}`)
  if (changed.length) {
    tx.update(rules).set(values).where(eq(rules.id, existing.id)).run()
    current.set(existing.id, {
      ...existing,
      ...values,
      categoryName: category?.name ?? null,
      transferAccountName: transfer?.name ?? null,
    })
  }
  if (position !== undefined) {
    const from = order.indexOf(existing.id)
    order.splice(from, 1)
    const to = Math.min(position - 1, order.length)
    order.splice(to, 0, existing.id)
    if (to !== from) changed.push(`moved to position ${to + 1}`)
  }
  if (changed.length)
    logChange(tx, actor, {
      action: "update",
      entity: "rule",
      entityId: existing.id,
      summary: `Changed rule ${described}: ${changed.join(", ")}`,
    })
}

/** An account a rule can make transfers to: there, and not closed. */
function openAccount(id: unknown, what: string) {
  if (!Number.isSafeInteger(id))
    throw new InvalidInput(`${what}: transferAccountId must be an account id`)
  const account = getAccount(id as number)
  if (account.closed)
    throw new InvalidInput(
      `${what}: ${account.name} is closed; a rule can't make transfers to it`
    )
  return account
}

function checkPosition(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new InvalidInput("position must be a whole number from 1")
  return value
}

/** Deletes rules by id, all of them or none. */
export function deleteRules(actor: Actor, ids: number[]): void {
  checkList(ids, "ids")
  const current = new Map(listRules().map((r) => [r.id, r]))
  const doomed = ids.map((id) => found(current.get(id), `rule ${id}`))
  db().transaction((tx) => {
    for (const rule of doomed) {
      tx.delete(rules).where(eq(rules.id, rule.id)).run()
      logChange(tx, actor, {
        action: "delete",
        entity: "rule",
        entityId: rule.id,
        summary: `Deleted rule ${describeRule(rule)}`,
      })
    }
  })
}

/**
 * For a category being deleted: its rules follow `moveTo` when there is one;
 * otherwise they lose the category, and a rule that then sets nothing goes.
 */
export function rulesLeaveCategory(
  tx: Tx,
  actor: Actor,
  categoryId: number,
  moveTo?: number
): void {
  if (moveTo !== undefined) {
    tx.update(rules)
      .set({ categoryId: moveTo })
      .where(eq(rules.categoryId, categoryId))
      .run()
    return
  }
  const emptied = listRules(tx).filter(
    (r) => r.categoryId === categoryId && !r.payee && !r.transferAccountId
  )
  for (const rule of emptied) {
    tx.delete(rules).where(eq(rules.id, rule.id)).run()
    logChange(tx, actor, {
      action: "delete",
      entity: "rule",
      entityId: rule.id,
      summary: `Deleted rule ${describeRule(rule)} with its category`,
    })
  }
  tx.update(rules)
    .set({ categoryId: null })
    .where(eq(rules.categoryId, categoryId))
    .run()
}

/** What a transfer rule did to a row (or, in a dry run, would do). */
type RuleTransfer = { id: number; accountId: number; linked?: number }

/**
 * Makes row `id`, a plain row a rule makes a transfer to `accountId`, one:
 * linked to the one row there that mirrors it when the account is fed by a
 * connection (a bank link or the broker), its other leg created when the
 * account is kept by hand (across currencies at the day's rate). Nothing
 * when the account is closed or the row's own, when the row can't be a leg,
 * when no row there mirrors it yet or two do equally, or across currencies
 * without a rate. `dryRun` only answers; rows in `taken` are passed over.
 */
function transferByRule(
  tx: Tx,
  actor: Actor,
  id: number,
  accountId: number,
  options: { dryRun?: boolean; taken?: Set<number> } = {}
): RuleTransfer | null {
  const target = getAccount(accountId)
  const row = getTransaction(id, tx)
  if (target.closed || row.accountId === accountId) return null
  if (target.provider) {
    const other = findMirror(tx, id, accountId, options.taken)
    if (other === null) return null
    if (!options.dryRun) linkPair(tx, actor, id, other)
    return { id, accountId, linked: other }
  }
  if (!isPossibleLeg(tx, id)) return null
  const from = getAccount(row.accountId).currency
  const amount =
    from === target.currency
      ? undefined
      : convert(-row.amount, from, target.currency, row.date)
  if (amount === null) return null
  if (!options.dryRun) makeTransfer(tx, actor, id, accountId, amount)
  return { id, accountId }
}

/**
 * New rows have arrived in `accountId` (a sync or an import): makes those a
 * rule makes transfers transfers, then, when the account is fed by a
 * connection, links the plain rows elsewhere still waiting for their other
 * side there (a rule makes them transfers to it, and their dates are within
 * the day window of the new rows'). So whichever side arrives second
 * completes the link. Oldest first, so the same rows always give the same links.
 */
export function transfersOnArrival(
  tx: Tx,
  actor: Actor,
  accountId: number,
  arrived: { id: number; date: string; transferAccountId: number | null }[],
  list: CompiledRule[] = loadRules(tx)
): void {
  for (const row of arrived)
    if (row.transferAccountId !== null)
      transferByRule(tx, actor, row.id, row.transferAccountId)
  if (
    !arrived.length ||
    !list.some((r) => r.transferAccountId === accountId) ||
    !getAccount(accountId).provider
  )
    return
  const dates = arrived.map((r) => r.date).sort()
  const waiting = tx
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      notes: transactions.notes,
      importedPayee: transactions.importedPayee,
      payeeName: payees.name,
    })
    .from(transactions)
    .leftJoin(payees, eq(transactions.payeeId, payees.id))
    .where(
      and(
        ne(transactions.accountId, accountId),
        isNull(transactions.transferId),
        sql`${transactions.date} between ${addDays(dates[0], -MAX_DAYS)} and ${addDays(dates.at(-1)!, MAX_DAYS)}`
      )
    )
    .orderBy(asc(transactions.date), asc(transactions.id))
    .all()
  for (const t of waiting) {
    const run = runRules(list, {
      bankText: t.importedPayee,
      notes: t.notes,
      payee: t.importedPayee ? cleanPayee(t.importedPayee) : t.payeeName,
      accountId: t.accountId,
    })
    if (run.transferAccountId === accountId)
      transferByRule(tx, actor, t.id, accountId)
  }
}

/** The transactions rules look at: everything but transfers. */
function subjects(where: Parameters<typeof and>) {
  return db()
    .select({
      id: transactions.id,
      date: transactions.date,
      payeeId: transactions.payeeId,
      payeeName: payees.name,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      notes: transactions.notes,
      importedPayee: transactions.importedPayee,
      accountId: transactions.accountId,
      onBudget: accounts.onBudget,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(payees, eq(transactions.payeeId, payees.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(isNull(transactions.transferId), ...where))
    .orderBy(sql`${transactions.date} desc`, sql`${transactions.id} desc`)
    .all()
}

/**
 * What one rule, on its own, matches among existing transactions: how many,
 * and a few examples of the bank's text with the payee it would give.
 */
export function testRule(input: {
  pattern: unknown
  payee?: unknown
}): RuleTest {
  const regex = compile(input.pattern, "the rule")
  const payee = checkPayee(input.payee, "the rule")
  let matches = 0
  const examples: RuleTest["examples"] = []
  const seen = new Set<string>()
  for (const t of subjects([])) {
    const current =
      t.payeeName ?? (t.importedPayee ? cleanPayee(t.importedPayee) : null)
    const match = firstMatch(regex, [t.importedPayee, t.notes, current])
    if (!match) continue
    matches++
    const bankText = t.importedPayee || current || t.notes
    if (examples.length < 3 && !seen.has(bankText.toLowerCase())) {
      seen.add(bankText.toLowerCase())
      examples.push({
        bankText,
        payee: (payee && fill(payee, match)) || current,
      })
    }
  }
  return { matches, examples }
}

/**
 * Runs the rules over existing transactions (transfers skipped): those with
 * `ids`, or in an account and date range, or all. By default it only fills
 * what is untouched: a category where there is none, and a payee where the
 * transaction has none or still carries the bank's own name or a name the
 * rules gave it (so a name rule added later renames it); `overwrite`
 * sets both wherever a rule matches. A row in an off-budget account gets no
 * category, as on import. A row a rule makes a transfer becomes one, as on
 * import (oldest first); none is ever unlinked. A dry run answers what would
 * change. The run is one Activity entry; payees it leaves with no
 * transactions and no default category are removed in the same step.
 */
export function applyRules(
  actor: Actor,
  options: ApplyRulesOptions = {}
): ApplyRulesResult {
  checkObject(options, "options")
  const where = []
  if (options.ids !== undefined)
    where.push(inArray(transactions.id, checkList(options.ids, "ids")))
  if (options.accountId !== undefined)
    where.push(eq(transactions.accountId, getAccount(options.accountId).id))
  if (options.from !== undefined)
    where.push(gte(transactions.date, checkDate(options.from, "from")))
  if (options.to !== undefined)
    where.push(lte(transactions.date, checkDate(options.to, "to")))
  const rows = subjects(where)
  const list = loadRules()
  const known = db()
    .select({
      id: payees.id,
      name: payees.name,
      defaultCategoryId: payees.defaultCategoryId,
      count: sql<number>`(select count(*) from ${transactions} where ${transactions.payeeId} = ${payees.id})`,
    })
    .from(payees)
    .all()
  const byName = new Map(known.map((p) => [p.name.toLowerCase(), p]))
  const categoryNames = new Map(
    db()
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .all()
      .map((c) => [c.id, c.name])
  )

  const result: ApplyRulesResult = {
    checked: rows.length,
    matched: 0,
    changed: 0,
    payeesSet: 0,
    categoriesSet: 0,
    transfersLinked: 0,
    transfersCreated: 0,
    payeesRemoved: 0,
  }
  const updates: { id: number; payeeName?: string; categoryId?: number }[] = []
  const sample = new Map<number, RuleChange>()
  // Rows a rule makes transfers, with the account each goes to.
  const transfers: { id: number; date: string; accountId: number }[] = []
  // Transactions moving off each payee, to find the payees a run empties.
  const leaving = new Map<number, number>()
  for (const t of rows) {
    const bankName = t.importedPayee ? cleanPayee(t.importedPayee) : null
    // From the bank's own name, as on import, so the rules see the same
    // chain of names they did then.
    const run = runRules(list, {
      bankText: t.importedPayee,
      notes: t.notes,
      payee: bankName ?? t.payeeName,
      accountId: t.accountId,
    })
    if (!run.matched) continue
    result.matched++
    if (run.transferAccountId !== null)
      transfers.push({
        id: t.id,
        date: t.date,
        accountId: run.transferAccountId,
      })
    // Untouched: no payee, the bank's own name, or a name the rules give on
    // the way (one an earlier run or the import set), not a hand edit. A
    // row without bank text was entered by hand: its payee is the person's.
    const untouchedPayee =
      t.payeeName === null ||
      (bankName !== null &&
        run.names.some((n) => n.toLowerCase() === t.payeeName!.toLowerCase()))
    const payee =
      run.payee &&
      (options.overwrite || untouchedPayee) &&
      run.payee.toLowerCase() !== t.payeeName?.toLowerCase()
        ? run.payee
        : null
    const finalPayee = payee ?? t.payeeName
    const categoryId =
      t.onBudget && (options.overwrite || t.categoryId === null)
        ? (run.categoryId ??
          (t.categoryId === null && finalPayee
            ? (byName.get(finalPayee.toLowerCase())?.defaultCategoryId ?? null)
            : null))
        : null
    const category =
      categoryId !== null && categoryId !== t.categoryId ? categoryId : null
    if (payee === null && category === null) continue
    if (payee !== null) result.payeesSet++
    if (category !== null) result.categoriesSet++
    if (payee !== null && t.payeeId !== null)
      leaving.set(t.payeeId, (leaving.get(t.payeeId) ?? 0) + 1)
    updates.push({
      id: t.id,
      ...(payee !== null ? { payeeName: payee } : {}),
      ...(category !== null ? { categoryId: category } : {}),
    })
    if (sample.size < 20)
      sample.set(t.id, {
        id: t.id,
        date: t.date,
        bankText: t.importedPayee,
        ...(payee !== null ? { payee: { from: t.payeeName, to: payee } } : {}),
        ...(category !== null
          ? {
              category: {
                from: t.categoryName,
                to: categoryNames.get(category) ?? "",
              },
            }
          : {}),
      })
  }
  // A payee every one of whose transactions moves away, and that has no
  // default category, is gone after the run (unless a rule names it).
  const emptied = known.filter(
    (p) =>
      p.defaultCategoryId === null &&
      p.count > 0 &&
      leaving.get(p.id) === p.count &&
      !updates.some((u) => u.payeeName?.toLowerCase() === p.name.toLowerCase())
  )
  result.payeesRemoved = emptied.length
  // Oldest first, as they would have arrived.
  transfers.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const accountNames = new Map<number, string>()
  /** Runs the transfers; a dry run answers what they would do. */
  const runTransfers = (tx: Tx, dryRun: boolean) => {
    const taken = new Set<number>()
    const changed = new Set(updates.map((u) => u.id))
    for (const { id, accountId } of transfers) {
      if (taken.has(id)) continue
      const done = transferByRule(tx, actor, id, accountId, { dryRun, taken })
      if (!done) continue
      taken.add(id)
      if (done.linked !== undefined) {
        taken.add(done.linked)
        result.transfersLinked++
      } else result.transfersCreated++
      changed.add(id)
      if (!accountNames.has(accountId))
        accountNames.set(accountId, getAccount(accountId).name)
      const transfer = {
        account: accountNames.get(accountId)!,
        ...(done.linked === undefined ? {} : { linkedId: done.linked }),
      }
      const t = rows.find((r) => r.id === id)!
      const entry = sample.get(id)
      if (entry) entry.transfer = transfer
      else if (sample.size < 20)
        sample.set(id, {
          id,
          date: t.date,
          bankText: t.importedPayee,
          transfer,
        })
    }
    result.changed = changed.size
  }
  if (options.dryRun) {
    db().transaction((tx) => runTransfers(tx, true))
    return { ...result, sample: [...sample.values()] }
  }
  if (!updates.length && !transfers.length) {
    result.changed = 0
    return result
  }

  const change = inBatch(() =>
    db().transaction((tx) => {
      patchTransactions(actor, updates)
      runTransfers(tx, false)
      for (const p of emptied) {
        tx.delete(payees).where(eq(payees.id, p.id)).run()
        logChange(tx, actor, {
          action: "delete",
          entity: "payee",
          entityId: p.id,
          summary: `Deleted payee ${p.name}, left with no transactions`,
        })
      }
      return tx
        .select({ batch: changes.batch })
        .from(changes)
        .orderBy(sql`${changes.id} desc`)
        .limit(1)
        .get()?.batch
    })
  )
  return {
    ...result,
    ...(change && result.changed ? { change } : {}),
  }
}
