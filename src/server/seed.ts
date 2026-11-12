// `florin seed-demo`: fills an empty florin with about eighteen months of
// believable data (EUR budget, five accounts including a USD brokerage with
// holdings and value history) for UI work and screenshots.
import * as data from "./data"
import { addMonths, monthEnd, today } from "./data/validate"
import type { ImportRow } from "@/shared/types"

const MONTHS = 18

/** Deterministic pseudo-random numbers, so every seeded instance looks the same. */
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32
    return seed / 2 ** 32
  }
}

export function seedDemo(): {
  accounts: number
  transactions: number
  months: number
} {
  if (data.listAccounts().length)
    throw new data.InvalidInput(
      "florin already has accounts; seed-demo only fills an empty one"
    )
  const rand = random(42)
  const between = (lo: number, hi: number) =>
    Math.round((lo + rand() * (hi - lo)) * 100)
  const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)]

  data.updateSettings("demo", { currency: "EUR" })
  const now = today()
  const thisMonth = now.slice(0, 7)
  const first = addMonths(thisMonth, -MONTHS + 1)
  const months = Array.from({ length: MONTHS }, (_, i) => addMonths(first, i))
  const day = (month: string, d: number) => {
    const date = `${month}-${String(Math.min(d, Number(monthEnd(month).slice(8)))).padStart(2, "0")}`
    return date <= now ? date : undefined
  }

  // Rates: units of USD per EUR, weekly, drifting around 1.08.
  const rates = []
  for (
    let d = new Date(`${first}-01T00:00:00Z`), r = 1.07;
    d.toISOString().slice(0, 10) <= now;
    d.setUTCDate(d.getUTCDate() + 7)
  ) {
    r = Math.min(1.16, Math.max(1.02, r + (rand() - 0.5) * 0.012))
    rates.push({
      date: d.toISOString().slice(0, 10),
      currency: "USD",
      rate: Math.round(r * 10_000) / 10_000,
    })
  }
  data.saveFxRates("demo", rates)
  const usdPerEur = (date: string) => data.rateOn("USD", date) ?? 1.08

  const groups = data.listCategoryGroups()
  const goals = groups.find((g) => g.name === "Goals")!
  data.createCategory("demo", { groupId: goals.id, name: "Investing" })
  const cat = (name: string) =>
    data
      .listCategoryGroups()
      .flatMap((g) => g.categories)
      .find((c) => c.name === name)!.id

  const start = `${first}-01`
  const current = data.createAccount("demo", {
    name: "Current account",
    type: "checking",
    startingBalance: 320_000,
    startingDate: start,
  })
  const savings = data.createAccount("demo", {
    name: "Savings",
    type: "savings",
    startingBalance: 800_000,
    startingDate: start,
  })
  const card = data.createAccount("demo", {
    name: "Credit card",
    type: "credit",
  })
  const cash = data.createAccount("demo", {
    name: "Cash",
    type: "cash",
    startingBalance: 12_000,
    startingDate: start,
  })
  const brokerage = data.createAccount("demo", {
    name: "Brokerage",
    type: "investment",
    currency: "USD",
  })

  const budgets: [string, number][] = [
    ["Rent", 125_000],
    ["Utilities", 11_000],
    ["Phone & internet", 4_500],
    ["Insurance", 13_500],
    ["Groceries", 45_000],
    ["Dining out", 18_000],
    ["Transport", 12_000],
    ["Shopping", 17_000],
    ["Emergency fund", 70_000],
    ["Holidays", 20_000],
    ["Investing", 30_000],
  ]

  let transactions = 0
  for (const month of months) {
    const currentRows: ImportRow[] = []
    const cardRows: ImportRow[] = []
    const cashRows: ImportRow[] = []
    const add = (
      rows: ImportRow[],
      d: number,
      amount: number,
      payee: string,
      category: string,
      notes?: string
    ) => {
      const date = day(month, d)
      if (date)
        rows.push({ date, amount, payee, categoryId: cat(category), notes })
    }

    add(
      currentRows,
      25,
      between(3_820, 3_880),
      "Northwind Labs",
      "Income",
      "Salary"
    )
    add(currentRows, 1, -125_000, "Harbour Lettings", "Rent")
    add(currentRows, 6, -between(70, 130), "City Power & Water", "Utilities")
    add(currentRows, 9, -4_499, "Fibrenet", "Phone & internet")
    add(currentRows, 15, -13_250, "Assura Health", "Insurance")
    add(currentRows, 3, -9_400, "Metro Transit", "Transport", "Monthly pass")
    for (let i = 0, n = 7 + Math.floor(rand() * 4); i < n; i++) {
      add(
        pick([currentRows, cardRows]),
        1 + Math.floor(rand() * 28),
        -between(14, 95),
        pick(["Albert Heijn", "Lidl", "Jumbo", "Ekoplaza"]),
        "Groceries"
      )
    }
    for (let i = 0, n = 3 + Math.floor(rand() * 4); i < n; i++) {
      add(
        cardRows,
        1 + Math.floor(rand() * 28),
        -between(12, 68),
        pick([
          "Café Lune",
          "Pizzeria Roma",
          "Noodle Bar",
          "De Kas",
          "Thai Orchid",
        ]),
        "Dining out"
      )
    }
    for (let i = 0, n = 1 + Math.floor(rand() * 3); i < n; i++) {
      add(
        cardRows,
        1 + Math.floor(rand() * 28),
        -between(15, 140),
        pick(["Bol.com", "IKEA", "Decathlon", "HEMA", "Zalando"]),
        "Shopping"
      )
    }
    for (let i = 0, n = 2 + Math.floor(rand() * 3); i < n; i++) {
      add(
        cashRows,
        1 + Math.floor(rand() * 28),
        -between(3, 12),
        pick(["Bakery Bloem", "Market stall", "Coffee cart"]),
        pick(["Groceries", "Dining out"])
      )
    }
    if (rand() < 0.35) add(cardRows, 18, -between(5, 25), "Uber", "Transport")
    if (["06", "07", "12"].includes(month.slice(5)) && rand() < 0.8) {
      add(
        cardRows,
        12,
        -between(380, 900),
        pick(["KLM", "Booking.com", "Airbnb"]),
        "Holidays"
      )
    }

    transactions += data.importTransactions(
      "demo",
      current.id,
      currentRows
    ).added
    transactions += data.importTransactions("demo", card.id, cardRows).added
    transactions += data.importTransactions("demo", cash.id, cashRows).added

    const cardSpend = -cardRows.reduce((s, r) => s + r.amount, 0)
    const moves: [day: number, to: number, amount: number][] = [
      [26, savings.id, -30_000],
      [27, card.id, -cardSpend],
      [10, cash.id, -10_000],
    ]
    for (const [d, to, amount] of moves) {
      const date = day(month, d)
      if (!date || !amount) continue
      data.createTransaction("demo", {
        accountId: current.id,
        date,
        amount,
        transferAccountId: to,
      })
      transactions++
    }
    const investDate = day(month, 28)
    if (investDate) {
      data.createTransaction("demo", {
        accountId: current.id,
        date: investDate,
        amount: -30_000,
        categoryId: cat("Investing"),
        transferAccountId: brokerage.id,
        transferAmount: Math.round(30_000 * usdPerEur(investDate)),
        notes: "Monthly investment",
      })
      transactions++
    }

    data.setBudgetAmounts(
      "demo",
      month,
      budgets.map(([name, amount]) => ({
        categoryId: cat(name),
        // The first month also assigns the opening balances.
        amount:
          amount +
          (month === first && name === "Emergency fund" ? 1_000_000 : 0) +
          (name !== "Holidays" && rand() < 0.2 ? 2_000 : 0),
      }))
    )
  }

  // A couple of card purchases still pending at the bank.
  for (const [payee, amount] of [
    ["Albert Heijn", -3_412],
    ["Café Lune", -1_850],
  ] as const) {
    data.importTransactions("demo", card.id, [
      {
        date: now,
        amount,
        payee,
        status: "pending",
        categoryId: cat(payee === "Café Lune" ? "Dining out" : "Groceries"),
      },
    ])
    transactions++
  }

  // The brokerage (USD): a value per weekday that grows with the monthly
  // deposits and the market, and today's holdings.
  const values = []
  let value = 1_850_000
  for (
    let d = new Date(`${start}T00:00:00Z`);
    d.toISOString().slice(0, 10) <= now;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const date = d.toISOString().slice(0, 10)
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue
    value = Math.round(value * (1 + (rand() - 0.46) * 0.016))
    if (date.endsWith("-02")) value += Math.round(30_000 * usdPerEur(date))
    values.push({ date, value })
  }
  data.setAccountValues("demo", brokerage.id, values)
  const positions = [
    {
      symbol: "VT",
      name: "Vanguard Total World Stock ETF",
      assetClass: "etf" as const,
      weight: 0.52,
      price: 128.4,
      gain: 0.21,
    },
    {
      symbol: "BND",
      name: "Vanguard Total Bond Market ETF",
      assetClass: "bond" as const,
      weight: 0.18,
      price: 72.9,
      gain: -0.03,
    },
    {
      symbol: "AAPL",
      name: "Apple Inc.",
      assetClass: "stock" as const,
      weight: 0.11,
      price: 231.5,
      gain: 0.34,
    },
    {
      symbol: "MSFT",
      name: "Microsoft Corp.",
      assetClass: "stock" as const,
      weight: 0.1,
      price: 438.2,
      gain: 0.12,
    },
    {
      symbol: "ASML",
      name: "ASML Holding NV",
      assetClass: "stock" as const,
      weight: 0.06,
      price: 702.1,
      gain: -0.08,
    },
  ]
  const cashValue =
    value - positions.reduce((s, p) => s + Math.round(value * p.weight), 0)
  data.replaceHoldings("demo", brokerage.id, [
    ...positions.map((p) => {
      const v = Math.round(value * p.weight)
      const costBasis = Math.round(v / (1 + p.gain))
      return {
        symbol: p.symbol,
        name: p.name,
        assetClass: p.assetClass,
        quantity: Math.round((v / 100 / p.price) * 1000) / 1000,
        price: p.price,
        value: v,
        costBasis,
        unrealizedPnl: v - costBasis,
        currency: "USD",
        asOf: now,
      }
    }),
    {
      symbol: "USD",
      name: "USD cash",
      assetClass: "cash",
      quantity: cashValue / 100,
      price: 1,
      value: cashValue,
      costBasis: null,
      unrealizedPnl: null,
      currency: "USD",
      asOf: now,
    },
  ])

  return { accounts: data.listAccounts().length, transactions, months: MONTHS }
}
