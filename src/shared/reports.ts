// API types for the dashboard's reports (/api/reports/*) and Overview's
// spending line. Amounts are minor units in the budget's currency unless a
// field says otherwise; dates are "YYYY-MM-DD", months "YYYY-MM".

/** What every report takes: a date range and, optionally, some accounts. */
export type ReportQuery = {
  /** Defaults to the first day of the month eleven months before `to`. */
  from?: string
  /** Defaults to today. */
  to?: string
  /** From the first transaction or value florin has; overrides `from`. */
  all?: boolean
  /** Only these accounts; every account when empty or absent. */
  accountIds?: number[]
}

/** Every report answers with the range it covers and when its data starts. */
export type ReportBase = {
  from: string
  to: string
  /** The earliest transaction (or value) in the covered accounts; null when there is none. */
  dataFrom: string | null
}

export type AccountGroup = "cash" | "credit" | "investments"

/** One point of net worth: the balances at the end of `date`. */
export type NetWorthDay = {
  date: string
  assets: number
  /** Positive: what is owed. */
  liabilities: number
  netWorth: number
}

/** How an amount in another currency was converted. */
export type Conversion = {
  /** The amount in the account's own currency. */
  amount: number
  /** Budget-currency units per one unit of the account's currency. */
  rate: number
  /** The date of the ECB rate used (the latest on or before the point's date). */
  rateDate: string
}

export type NetWorthAccount = {
  id: number
  name: string
  currency: string
  group: AccountGroup
  closed: boolean
  /** Balance at the start of the range (the end of the day before), converted; null without a rate. */
  start: number | null
  end: number | null
  /** end − start, exchange-rate movement included; null when either is. */
  change: number | null
  /** Set for accounts in another currency. */
  startConversion: Conversion | null
  endConversion: Conversion | null
}

export type NetWorthReport = ReportBase & {
  /** Month ends (days when the range is three months or less, or weeks when asked). */
  step: "day" | "week" | "month"
  points: NetWorthDay[]
  accounts: NetWorthAccount[]
  /** Some account in another currency has no rate yet and is left out of the totals. */
  missingRates: boolean
}

export type SpendingCategory = {
  /** null for spending without a category. */
  categoryId: number | null
  name: string
  amount: number
  /** The same length of time just before the range. */
  previous: number
}

export type SpendingGroup = {
  /** null for spending without a category. */
  groupId: number | null
  name: string
  amount: number
  previous: number
  /** Largest first. */
  categories: SpendingCategory[]
}

export type SpendingReport = ReportBase & {
  /** Months in the range, counting a part month as one; for averages. */
  months: number
  previousFrom: string
  previousTo: string
  total: number
  previousTotal: number
  /** Largest first; groups with no spending in either period are left out. */
  groups: SpendingGroup[]
}

export type IncomeExpenseMonth = {
  month: string
  income: number
  expenses: number
  net: number
  /** net / income; null without income. */
  savingsRate: number | null
}

export type IncomeExpenseReport = ReportBase & { months: IncomeExpenseMonth[] }

export type CashFlowMonth = {
  month: string
  /** Balance of the cash accounts at the start of the month. */
  starting: number
  inflow: number
  /** Positive. */
  outflow: number
  net: number
  ending: number
}

export type CashFlowReport = ReportBase & { months: CashFlowMonth[] }

/** Cumulative spending by day of month, for Overview's this-month line. */
export type MonthSpending = {
  month: string
  /** Index 0 is the 1st. Up to today for the current month, the whole month otherwise. */
  days: number[]
}

export type SpendingByDay = { current: MonthSpending; previous: MonthSpending }
