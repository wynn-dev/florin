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
    | "rule"
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
  "checking" | "savings" | "credit" | "cash" | "investment" | "loan"
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
  /**
   * BCP 47 tag for number and date formats, e.g. "en-GB" or "de-DE"; empty
   * until first set, which means en-GB.
   */
  locale: string
  /**
   * IANA time zone "today" and "this month" are in, e.g. "Europe/Helsinki";
   * empty means the machine's own.
   */
  timeZone: string
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
  /** Defaults to true for every type except investment and loan, when the account is in the budget's currency. */
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

export type Payee = {
  id: number
  name: string
  transactionCount: number
  /** New transactions from this payee that arrive without a category get it. */
  defaultCategoryId: number | null
}

/**
 * A rule that names and categorises transactions from the bank's text. Rules
 * run in position order; a later match overrides an earlier one.
 */
export type Rule = {
  id: number
  /** Its place in the list, from 1. */
  position: number
  /** JavaScript regular expression source, matched case-insensitively. */
  pattern: string
  /** The payee name it sets; $1…$9 are the match's captured parts. */
  payee: string | null
  categoryId: number | null
  categoryName: string | null
  /** The person's own account a matching row is a transfer to. */
  transferAccountId: number | null
  transferAccountName: string | null
}

/** A rule to create (no id) or change (id; only the fields given change). */
export type RuleInput = {
  id?: number
  pattern?: string
  /** null clears it. */
  payee?: string | null
  /** null clears it. */
  categoryId?: number | null
  /** null clears it. */
  transferAccountId?: number | null
  /** Its place in the list, from 1; new rules without one go last. */
  position?: number
}

/** Which existing transactions to run the rules over; none given means all. */
export type ApplyRulesOptions = {
  ids?: number[]
  accountId?: number
  from?: string
  to?: string
  /** Answer what would change without writing it. */
  dryRun?: boolean
  /** Set payee and category wherever a rule matches, not only where untouched. */
  overwrite?: boolean
}

/** One transaction an apply run changes (or would). */
export type RuleChange = {
  id: number
  date: string
  bankText: string | null
  payee?: { from: string | null; to: string }
  category?: { from: string | null; to: string }
  /** Made a transfer to this account: linked to the row there, or its leg created. */
  transfer?: { account: string; linkedId?: number }
}

export type ApplyRulesResult = {
  /** Transactions looked at (transfers are skipped). */
  checked: number
  /** Of those, how many some rule matched. */
  matched: number
  changed: number
  payeesSet: number
  categoriesSet: number
  /** Linked to the mirroring row in a transfer rule's account. */
  transfersLinked: number
  /** Made transfers to a hand-kept account, its leg created. */
  transfersCreated: number
  /** Payees left with no transactions and no default category, removed. */
  payeesRemoved: number
  /** A few of the changes, for a dry run. */
  sample?: RuleChange[]
  /** The Activity entry of the run; absent for a dry run or when nothing changed. */
  change?: number
}

/** What one rule would match among existing transactions (for the rule dialog). */
export type RuleTest = {
  matches: number
  examples: { bankText: string; payee: string | null }[]
}

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
  /**
   * For a transfer: the other leg stays, as a plain row, when this one is
   * deleted or stops being a transfer, and keeps its own date, notes and
   * status when this one is edited: it came from a bank or an import, or the
   * two were linked, each a transaction of its own. False when florin made
   * the transfer and the other leg goes with this one, and for non-transfers.
   */
  transferKept: boolean
  /** An account's opening balance, which can't be a transfer. */
  startingBalance: boolean
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
  /**
   * Left to spend: last month's available when it was positive (leftover
   * carries, overspending doesn't) + budgeted + activity. Negative = overspent
   * this month; at month end that comes out of next month's toBudget.
   */
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
  /** This month's overspending: the overspent categories' available, as a positive amount. */
  overspent: number
  /** Last month's overspending, as a positive amount: taken out of this month's toBudget. */
  lastMonthOverspent: number
  /**
   * Ready to assign: all income to date minus everything budgeted to date
   * minus the overspending of every earlier month; negative means over-assigned.
   */
  toBudget: number
  /** The first month with a transaction in an on-budget account; null before any. */
  firstMonth: string | null
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
  /** Net of transfers to and from the person's other accounts. */
  transfers: number
  /** inflow − outflow + transfers. */
  net: number
}

export type ApiError = { error: string }
