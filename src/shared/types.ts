// Types shared by the server's data layer, the /api routes, the web app and
// the MCP. Amounts are integers in minor units (cents). An account's amounts
// are in its own currency; budget and report amounts are in the budget's
// currency (Settings.currency). Dates are "YYYY-MM-DD", months "YYYY-MM".

/**
 * Who makes a change: the person in the dashboard, an MCP client (by its
 * name), a bank's sync, IBKR, a file import (by the file's name), or the
 * demo seed.
 */
export type Actor =
  | "person"
  | "bank-sync"
  | "import"
  | "ibkr"
  | "demo"
  | `mcp:${string}`
  | `bank-sync:${string}`
  | `import:${string}`

export type Change = {
  id: number
  /** ISO timestamp, UTC. */
  at: string
  actor: Actor
  action: "create" | "update" | "delete"
  entity:
    | "account"
    | "transaction"
    | "payee"
    | "category"
    | "category group"
    | "budget"
    | "settings"
    | "fx rate"
    | "mcp token"
  entityId: number | null
  /** One readable line, e.g. "Added −€42.50 at Lidl to Current account". */
  summary: string
  /** The id of the first change of the same call or run; one batch is one Activity entry. */
  batch: number
  /** What changed on the entity alone, e.g. "Category set to Groceries". */
  detail: string | null
}

/** A page of a list, with the total number of matches. */
export type Page<T> = { items: T[]; total: number }

export type AccountType =
  "checking" | "savings" | "credit" | "cash" | "investment"
export type Provider = "enablebanking" | "ibkr"
export type TransactionStatus = "pending" | "cleared"

export type Settings = {
  /** The budget's currency, ISO 4217 (e.g. "EUR"). */
  currency: string
  /**
   * The address people and services reach florin at, e.g.
   * "https://florin.example.com"; empty means http://localhost:<port>.
   */
  publicUrl: string
}

/** Units of `currency` per 1 EUR on `date`, as the ECB publishes them. */
export type FxRate = { date: string; currency: string; rate: number }

export type Account = {
  id: number
  name: string
  type: AccountType
  /** The account's own currency; balance and clearedBalance are in it. */
  currency: string
  /** Only accounts in the budget's currency can be on budget. */
  onBudget: boolean
  closed: boolean
  provider: Provider | null
  externalId: string | null
  /** Sum of transactions, or for accounts with value snapshots (investments) the latest snapshot. */
  balance: number
  /** Balance counting only cleared transactions (equals balance for investments). */
  clearedBalance: number
  /** balance in the budget's currency at today's rate; null when no rate is known. */
  budgetBalance: number | null
}

export type NewAccount = {
  name: string
  type: AccountType
  /** Defaults to the budget's currency. */
  currency?: string
  /** Defaults to true for every type except investment, when the account is in the budget's currency. */
  onBudget?: boolean
  /** Opening balance, booked as a "Starting balance" transaction today. */
  startingBalance?: number
  startingDate?: string
}

export type AccountPatch = Partial<
  Pick<Account, "name" | "type" | "onBudget" | "closed">
>

export type AccountValue = { date: string; value: number }

/** How a holding counts in an account's allocation. */
export type AssetClass = "stock" | "etf" | "bond" | "cash" | "other"

/**
 * One position of an investment account, or its cash in one currency
 * (assetClass "cash": symbol and currency are the currency's code, quantity
 * the amount in it, price 1).
 */
export type Holding = {
  symbol: string
  name: string
  assetClass: AssetClass
  quantity: number
  /** Unit price in the holding's own currency. */
  price: number
  /** Market value in the account's currency. */
  value: number
  /** What the position cost, in the account's currency; null when unknown and for cash. */
  costBasis: number | null
  /** value − costBasis as the broker reports it, in the account's currency; null when unknown and for cash. */
  unrealizedPnl: number | null
  /** The holding's own currency (its price is in it). */
  currency: string
  asOf: string
}

/** A holding as written: asset class defaults to "other", cost basis and P/L to unknown. */
export type NewHolding = Omit<
  Holding,
  "assetClass" | "costBasis" | "unrealizedPnl"
> &
  Partial<Pick<Holding, "assetClass" | "costBasis" | "unrealizedPnl">>

export type Payee = { id: number; name: string; transactionCount: number }

export type Category = {
  id: number
  groupId: number
  name: string
  hidden: boolean
}

export type CategoryGroup = {
  id: number
  name: string
  isIncome: boolean
  categories: Category[]
}

export type Transaction = {
  id: number
  accountId: number
  accountName: string
  date: string
  amount: number
  payeeId: number | null
  payeeName: string | null
  categoryId: number | null
  categoryName: string | null
  notes: string
  status: TransactionStatus
  /** For a transfer: the other leg's id and account. */
  transferId: number | null
  transferAccountId: number | null
  transferAccountName: string | null
  importedId: string | null
  importedPayee: string | null
  bookedDate: string | null
  /** For a transfer: the other leg's amount, in its account's currency. */
  transferAmount: number | null
  /** The account's balance after this transaction; only when listing one account. */
  balance?: number
}

export type TransactionFilter = {
  accountId?: number
  categoryId?: number
  /** Any of these categories. */
  categoryIds?: number[]
  payeeId?: number
  /** Only transactions in on-budget accounts without a category (transfers excluded). */
  uncategorized?: boolean
  status?: TransactionStatus
  from?: string
  to?: string
  /** Amount bounds in minor units, inclusive; money out is negative. */
  minAmount?: number
  maxAmount?: number
  /** Matches payee, notes, imported payee text, category name and an exact amount ("42.10"). */
  search?: string
  /** Only the transactions an Activity entry (a change batch) added or changed. */
  change?: number
  limit?: number
  offset?: number
}

export type TransactionPage = Page<Transaction> & {
  /** The sum of every match, per currency (one entry unless accounts differ in currency). */
  sums: { currency: string; amount: number }[]
}

export type NewTransaction = {
  accountId: number
  date: string
  amount: number
  /** An existing payee id, or a name that is created when new. */
  payeeId?: number | null
  payeeName?: string | null
  categoryId?: number | null
  notes?: string
  status?: TransactionStatus
  /** Makes this a transfer: a mirrored transaction is created in that account. */
  transferAccountId?: number
  /** What arrives in the other account, for transfers between currencies. Defaults to -amount. */
  transferAmount?: number
  /** The bank's fields, for putting back a deleted bank transaction (Undo) so a later sync still skips it. */
  importedId?: string | null
  importedPayee?: string | null
  bookedDate?: string | null
}

export type TransactionPatch = Partial<
  Omit<
    NewTransaction,
    "transferAccountId" | "importedId" | "importedPayee" | "bookedDate"
  > & {
    transferAccountId: number | null
  }
>

/** One incoming row from a bank sync or a CSV file. */
export type ImportRow = {
  date: string
  amount: number
  /** Raw payee/description text; also used as the payee name. */
  payee: string
  notes?: string
  /** The bank's id for the transaction. CSV rows get one derived from their content. */
  importedId?: string
  bookedDate?: string
  status?: TransactionStatus
  categoryId?: number | null
}

export type ImportResult = {
  added: number
  skipped: number
  /** The Activity entry (change batch) of what was added; absent when nothing was. */
  change?: number
}

export type BudgetAmount = { categoryId: number; amount: number }

export type CsvMapping = {
  date: string
  /** One signed amount column, or separate inflow/outflow columns. */
  amount?: string
  inflow?: string
  outflow?: string
  payee: string
  notes?: string
  dateFormat?: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" | "DD.MM.YYYY"
  /** "," when amounts use a decimal comma (1.234,56). */
  decimal?: "." | ","
}

export type BudgetCategory = {
  id: number
  name: string
  hidden: boolean
  budgeted: number
  /** Net of this month's transactions in the category (spending is negative). */
  activity: number
  /** Left to spend: last month's available carried over + budgeted + activity. */
  available: number
}

export type BudgetGroup = {
  id: number
  name: string
  budgeted: number
  activity: number
  available: number
  categories: BudgetCategory[]
}

export type BudgetMonth = {
  month: string
  /** Income received this month (income categories, on-budget accounts). */
  income: number
  budgeted: number
  activity: number
  available: number
  /** All income to date minus everything budgeted to date; negative means over-assigned. */
  toBudget: number
  groups: BudgetGroup[]
}

export type DateRange = { from: string; to: string }

/** In the budget's currency; accounts in other currencies are converted at each month end's rate. */
export type NetWorthPoint = {
  month: string
  assets: number
  debts: number
  netWorth: number
}
export type CategorySpending = {
  categoryId: number | null
  categoryName: string
  groupName: string
  amount: number
}
export type IncomeExpensePoint = {
  month: string
  income: number
  expenses: number
}
export type CashFlowPoint = {
  month: string
  inflow: number
  outflow: number
  net: number
}

export type ApiError = { error: string }
