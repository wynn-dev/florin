import { and, asc, desc, eq, sql } from "drizzle-orm"
import { db, schema } from "../db"
import { runJobSoon } from "../jobs"
import { startingBalanceCategoryId } from "./categories"
import { describe, logChange, money } from "./changes"
import { checkCurrency, convert } from "./fx"
import { payeeIdForName } from "./payees"
import { getSettings } from "./settings"
import {
  InvalidInput,
  checkAmount,
  checkDate,
  checkList,
  checkName,
  checkObject,
  found,
  today,
} from "./validate"
import type {
  Account,
  AccountPatch,
  AccountType,
  AccountValue,
  Actor,
  AssetClass,
  Holding,
  NewAccount,
  NewHolding,
} from "@/shared/types"

const { accounts, transactions, accountValues, holdings } = schema

const TYPES: AccountType[] = [
  "checking",
  "savings",
  "credit",
  "cash",
  "investment",
]

function checkType(value: unknown): AccountType {
  if (!TYPES.includes(value as AccountType)) {
    throw new InvalidInput(`type must be one of ${TYPES.join(", ")}`)
  }
  return value as AccountType
}

/**
 * Every account with its balance. An account with value snapshots (an
 * investment account) is worth its latest snapshot; any other account is the
 * sum of its transactions.
 */
export function listAccounts(): Account[] {
  const budgetCurrency = getSettings().currency
  const date = today()
  const latestValue = sql<
    number | null
  >`(select ${accountValues.value} from ${accountValues}
    where ${accountValues.accountId} = ${accounts.id} order by ${accountValues.date} desc limit 1)`
  const sum = sql<number>`(select coalesce(sum(${transactions.amount}), 0) from ${transactions}
    where ${transactions.accountId} = ${accounts.id})`
  const cleared = sql<number>`(select coalesce(sum(${transactions.amount}), 0) from ${transactions}
    where ${transactions.accountId} = ${accounts.id} and ${transactions.status} = 'cleared')`
  return db()
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currency: accounts.currency,
      onBudget: accounts.onBudget,
      closed: accounts.closed,
      provider: accounts.provider,
      externalId: accounts.externalId,
      latestValue,
      sum,
      cleared,
    })
    .from(accounts)
    .orderBy(asc(accounts.closed), asc(accounts.sortOrder), asc(accounts.id))
    .all()
    .map(({ latestValue: value, sum: total, cleared: clearedTotal, ...a }) => {
      const balance = value ?? total
      return {
        ...a,
        balance,
        clearedBalance: value ?? clearedTotal,
        budgetBalance: convert(balance, a.currency, budgetCurrency, date),
      }
    })
}

export function getAccount(id: number): Account {
  return found(
    listAccounts().find((a) => a.id === id),
    `account ${id}`
  )
}

export function createAccount(actor: Actor, input: NewAccount): Account {
  const name = checkName(input.name)
  const type = checkType(input.type)
  const budgetCurrency = getSettings().currency
  const currency =
    input.currency === undefined
      ? budgetCurrency
      : checkCurrency(input.currency)
  const onBudget =
    input.onBudget ?? (type !== "investment" && currency === budgetCurrency)
  if (onBudget && currency !== budgetCurrency) {
    throw new InvalidInput(`only ${budgetCurrency} accounts can be on budget`)
  }
  const startingBalance = checkAmount(
    input.startingBalance ?? 0,
    "startingBalance"
  )
  const date = input.startingDate
    ? checkDate(input.startingDate, "startingDate")
    : today()
  const id = db().transaction((tx) => {
    const row = tx
      .insert(accounts)
      .values({
        name,
        type,
        currency,
        onBudget,
        sortOrder: sql`(select coalesce(max(${accounts.sortOrder}), 0) + 1 from ${accounts})`,
      })
      .returning({ id: accounts.id })
      .get()
    if (startingBalance !== 0) {
      tx.insert(transactions)
        .values({
          accountId: row.id,
          date,
          amount: startingBalance,
          payeeId: payeeIdForName("Starting balance", tx),
          categoryId: onBudget ? startingBalanceCategoryId(tx) : null,
        })
        .run()
    }
    logChange(tx, actor, {
      action: "create",
      entity: "account",
      entityId: row.id,
      summary:
        `Added ${type} account ${name}` +
        (startingBalance ? ` with ${money(startingBalance, currency)}` : ""),
    })
    return row.id
  })
  if (currency !== budgetCurrency) runJobSoon("ecb")
  return getAccount(id)
}

export function updateAccount(
  actor: Actor,
  id: number,
  patch: AccountPatch
): Account {
  const current = getAccount(id)
  const set: Partial<typeof accounts.$inferInsert> = {}
  if (patch.name !== undefined) set.name = checkName(patch.name)
  if (patch.type !== undefined) set.type = checkType(patch.type)
  if (patch.onBudget !== undefined) {
    const budgetCurrency = getSettings().currency
    if (patch.onBudget && current.currency !== budgetCurrency) {
      throw new InvalidInput(`only ${budgetCurrency} accounts can be on budget`)
    }
    set.onBudget = Boolean(patch.onBudget)
  }
  if (patch.closed !== undefined) set.closed = Boolean(patch.closed)
  if (!Object.keys(set).length) return current
  db().transaction((tx) => {
    tx.update(accounts).set(set).where(eq(accounts.id, id)).run()
    logChange(tx, actor, {
      action: "update",
      entity: "account",
      entityId: id,
      summary: `Changed account ${current.name}: ${describe(set)}`,
    })
  })
  return getAccount(id)
}

/** Deletes an account and its transactions; transfers into it become plain transactions. */
export function deleteAccount(actor: Actor, id: number): void {
  const account = getAccount(id)
  db().transaction((tx) => {
    const legs = tx
      .select({ transferId: transactions.transferId })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, id),
          sql`${transactions.transferId} is not null`
        )
      )
      .all()
    for (const { transferId } of legs) {
      tx.update(transactions)
        .set({ transferId: null })
        .where(eq(transactions.id, transferId!))
        .run()
    }
    tx.delete(accounts).where(eq(accounts.id, id)).run()
    logChange(tx, actor, {
      action: "delete",
      entity: "account",
      entityId: id,
      summary: `Deleted account ${account.name} and its transactions`,
    })
  })
}

/** Marks an account as owned by a connector (Enable Banking or IBKR), or unlinks it with null. */
export function linkAccount(
  actor: Actor,
  id: number,
  link: { provider: Account["provider"]; externalId: string | null }
): Account {
  const account = getAccount(id)
  db().transaction((tx) => {
    tx.update(accounts)
      .set({
        provider: link.provider,
        externalId: link.provider ? link.externalId : null,
      })
      .where(eq(accounts.id, id))
      .run()
    logChange(tx, actor, {
      action: "update",
      entity: "account",
      entityId: id,
      summary: link.provider
        ? `Linked ${account.name} to ${link.provider}`
        : `Unlinked ${account.name}`,
    })
  })
  return getAccount(id)
}

export function listAccountValues(accountId: number): AccountValue[] {
  getAccount(accountId)
  return db()
    .select({ date: accountValues.date, value: accountValues.value })
    .from(accountValues)
    .where(eq(accountValues.accountId, accountId))
    .orderBy(asc(accountValues.date))
    .all()
}

/** Records what an account was worth on a date (replacing that date's value). */
export function setAccountValue(
  actor: Actor,
  accountId: number,
  date: string,
  value: number
): void {
  const account = getAccount(accountId)
  checkDate(date)
  checkAmount(value, "value")
  db().transaction((tx) => {
    tx.insert(accountValues)
      .values({ accountId, date, value })
      .onConflictDoUpdate({
        target: [accountValues.accountId, accountValues.date],
        set: { value },
      })
      .run()
    logChange(tx, actor, {
      action: "update",
      entity: "account",
      entityId: accountId,
      summary: `Valued ${account.name} at ${money(value, account.currency)} on ${date}`,
    })
  })
}

const ASSET_CLASSES: AssetClass[] = ["stock", "etf", "bond", "cash", "other"]

export function listHoldings(accountId: number): Holding[] {
  getAccount(accountId)
  return db()
    .select({
      symbol: holdings.symbol,
      name: holdings.name,
      assetClass: holdings.assetClass,
      quantity: holdings.quantity,
      price: holdings.price,
      value: holdings.value,
      costBasis: holdings.costBasis,
      unrealizedPnl: holdings.unrealizedPnl,
      currency: holdings.currency,
      asOf: holdings.asOf,
    })
    .from(holdings)
    .where(eq(holdings.accountId, accountId))
    .orderBy(desc(holdings.value))
    .all()
}

/** Checks a list of holdings for replaceHoldings (and the IBKR connector). */
export function checkHoldings(positions: NewHolding[]): Holding[] {
  return checkList(positions, "holdings").map((p) => {
    checkObject(p, "each holding")
    const assetClass = p.assetClass ?? "other"
    if (!ASSET_CLASSES.includes(assetClass))
      throw new InvalidInput(
        `assetClass must be one of ${ASSET_CLASSES.join(", ")}`
      )
    if (typeof p.quantity !== "number" || !Number.isFinite(p.quantity))
      throw new InvalidInput("quantity must be a number")
    if (typeof p.price !== "number" || !Number.isFinite(p.price))
      throw new InvalidInput("price must be a number")
    return {
      symbol: checkName(p.symbol, "symbol"),
      name: typeof p.name === "string" ? p.name.trim() : "",
      assetClass,
      quantity: p.quantity,
      price: p.price,
      value: checkAmount(p.value, "value"),
      costBasis:
        p.costBasis == null ? null : checkAmount(p.costBasis, "costBasis"),
      unrealizedPnl:
        p.unrealizedPnl == null
          ? null
          : checkAmount(p.unrealizedPnl, "unrealizedPnl"),
      currency: checkCurrency(p.currency),
      asOf: checkDate(p.asOf, "asOf"),
    }
  })
}

/** Replaces an account's holdings with the given positions. */
export function replaceHoldings(
  actor: Actor,
  accountId: number,
  positions: NewHolding[]
): Holding[] {
  const account = getAccount(accountId)
  const rows = checkHoldings(positions)
  db().transaction((tx) => {
    tx.delete(holdings).where(eq(holdings.accountId, accountId)).run()
    if (rows.length) {
      tx.insert(holdings)
        .values(rows.map((p) => ({ ...p, accountId })))
        .run()
    }
    logChange(tx, actor, {
      action: "update",
      entity: "account",
      entityId: accountId,
      summary: `Updated ${account.name}'s holdings (${rows.length} positions)`,
    })
  })
  return listHoldings(accountId)
}

/**
 * Records many dated values at once (replacing those dates' values), with
 * one line in the change log.
 */
export function setAccountValues(
  actor: Actor,
  accountId: number,
  values: AccountValue[]
): void {
  const account = getAccount(accountId)
  for (const v of checkList(values, "values")) {
    checkObject(v, "each value")
    checkDate(v.date)
    checkAmount(v.value, "value")
  }
  if (!values.length) return
  db().transaction((tx) => {
    for (const { date, value } of values) {
      tx.insert(accountValues)
        .values({ accountId, date, value })
        .onConflictDoUpdate({
          target: [accountValues.accountId, accountValues.date],
          set: { value },
        })
        .run()
    }
    const dates = values.map((v) => v.date).sort()
    logChange(tx, actor, {
      action: "update",
      entity: "account",
      entityId: accountId,
      summary: `Recorded ${values.length} values of ${account.name} from ${dates[0]} to ${dates.at(-1)}`,
    })
  })
}
