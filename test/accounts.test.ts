// Account pages' data: loan accounts and the weekly balance history.
import { describe, expect, test } from "vitest"
import { useTempHome } from "./setup"
import * as data from "@/server/data"
import { today } from "@/server/data/validate"

useTempHome()

function daysAgo(n: number): string {
  const d = new Date(`${today()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

describe("accounts", () => {
  test("loans are a type of their own, off budget by default", () => {
    const loan = data.createAccount("person", {
      name: "Car loan",
      type: "loan",
      startingBalance: -1_200_000,
    })
    expect(loan).toMatchObject({ type: "loan", onBudget: false })
  })

  test("balances come a week apart over the last year, ending today", () => {
    const account = data.createAccount("person", {
      name: "Checking",
      type: "checking",
      startingBalance: 100_000,
      startingDate: daysAgo(500),
    })
    data.createTransaction("person", {
      accountId: account.id,
      date: daysAgo(10),
      amount: -25_000,
    })
    data.createTransaction("person", {
      accountId: account.id,
      date: today(),
      amount: -5_000,
    })
    const points = data.listAccountBalances(account.id)
    expect(points.length).toBeGreaterThanOrEqual(52)
    expect(points.length).toBeLessThanOrEqual(53)
    expect(points.at(-1)).toEqual({ date: today(), value: 70_000 })
    expect(points.at(-2)).toEqual({ date: daysAgo(7), value: 75_000 })
    expect(points.at(-3)).toEqual({ date: daysAgo(14), value: 100_000 })
    expect(points[0].value).toBe(100_000)
  })

  test("balances start at the account's first transaction", () => {
    const account = data.createAccount("person", {
      name: "New",
      type: "checking",
      startingBalance: 5_000,
      startingDate: daysAgo(20),
    })
    const points = data.listAccountBalances(account.id)
    expect(points).toEqual([
      { date: daysAgo(21), value: 0 },
      { date: daysAgo(14), value: 5_000 },
      { date: daysAgo(7), value: 5_000 },
      { date: today(), value: 5_000 },
    ])
    const fresh = data.createAccount("person", {
      name: "Fresh",
      type: "checking",
      startingBalance: 100,
    })
    expect(data.listAccountBalances(fresh.id)).toEqual([
      { date: today(), value: 100 },
    ])
  })

  test("an investment account's balances are its values in the window", () => {
    const account = data.createAccount("person", {
      name: "Brokerage",
      type: "investment",
      currency: "USD",
    })
    data.setAccountValue("person", account.id, daysAgo(800), 1_000)
    data.setAccountValue("person", account.id, daysAgo(30), 2_000)
    data.setAccountValue("person", account.id, today(), 3_000)
    expect(data.listAccountBalances(account.id)).toEqual([
      { date: daysAgo(30), value: 2_000 },
      { date: today(), value: 3_000 },
    ])
  })
})
