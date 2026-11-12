// florin's database. Money is integer minor units (cents) in the currency of
// the account it belongs to; the budget has one currency (settings) and only
// accounts in it can be on budget. Dates are "YYYY-MM-DD" text, months "YYYY-MM".
import { sql } from "drizzle-orm"
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

/** Budget-wide settings (currency and the like), one row per key. */
export const settings = sqliteTable("settings", {
  key: text().primaryKey(),
  value: text().notNull(),
})

export const accounts = sqliteTable(
  "accounts",
  {
    id: integer().primaryKey(),
    name: text().notNull(),
    type: text({
      enum: ["checking", "savings", "credit", "cash", "investment"],
    }).notNull(),
    /** ISO 4217 code; the account's transactions, values and holdings are in it. */
    currency: text().notNull(),
    /** On-budget accounts feed the envelope budget; only accounts in the budget's currency can be. */
    onBudget: integer("on_budget", { mode: "boolean" }).notNull(),
    closed: integer({ mode: "boolean" }).notNull().default(false),
    /** Set when a connector owns the account: "enablebanking" or "ibkr". */
    provider: text({ enum: ["enablebanking", "ibkr"] }),
    /** The provider's own id for the account. */
    externalId: text("external_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [
    uniqueIndex("accounts_provider_external").on(t.provider, t.externalId),
  ]
)

export const payees = sqliteTable("payees", {
  id: integer().primaryKey(),
  name: text().notNull().unique(),
})

export const categoryGroups = sqliteTable("category_groups", {
  id: integer().primaryKey(),
  name: text().notNull(),
  /** Income groups hold the categories money arrives in; it becomes "to budget". */
  isIncome: integer("is_income", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
})

export const categories = sqliteTable(
  "categories",
  {
    id: integer().primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => categoryGroups.id, { onDelete: "cascade" }),
    name: text().notNull(),
    hidden: integer({ mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("categories_group").on(t.groupId)]
)

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer().primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: text().notNull(),
    amount: integer().notNull(),
    payeeId: integer("payee_id").references(() => payees.id, {
      onDelete: "set null",
    }),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    notes: text().notNull().default(""),
    status: text({ enum: ["pending", "cleared"] })
      .notNull()
      .default("cleared"),
    /** The other leg of a transfer between two accounts. */
    transferId: integer("transfer_id"),
    /** The bank's (or a CSV row's) own id; unique per account, used to skip duplicates on import. */
    importedId: text("imported_id"),
    /** Payee/description text exactly as the bank or file gave it. */
    importedPayee: text("imported_payee"),
    /** The bank's booking date when it differs from the transaction date. */
    bookedDate: text("booked_date"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [
    index("transactions_account_date").on(t.accountId, t.date),
    index("transactions_date").on(t.date),
    index("transactions_category").on(t.categoryId),
    uniqueIndex("transactions_account_imported").on(t.accountId, t.importedId),
  ]
)

/** Envelope budget: the amount assigned to a category in a month. */
export const budgets = sqliteTable(
  "budgets",
  {
    month: text().notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    amount: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.month, t.categoryId] })]
)

/** Dated values for accounts whose worth is not the sum of their transactions (investments). */
export const accountValues = sqliteTable(
  "account_values",
  {
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: text().notNull(),
    value: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.date] })]
)

/** Current positions of an investment account. */
export const holdings = sqliteTable(
  "holdings",
  {
    id: integer().primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text().notNull(),
    name: text().notNull(),
    assetClass: text("asset_class", {
      enum: ["stock", "etf", "bond", "cash", "other"],
    })
      .notNull()
      .default("other"),
    quantity: real().notNull(),
    /** Price per unit in the holding's own currency. */
    price: real().notNull(),
    /** Market value in the account's currency, minor units. */
    value: integer().notNull(),
    /** What the position cost, account currency, minor units. */
    costBasis: integer("cost_basis"),
    /** Unrealised profit or loss, account currency, minor units. */
    unrealizedPnl: integer("unrealized_pnl"),
    currency: text().notNull(),
    asOf: text("as_of").notNull(),
  },
  (t) => [uniqueIndex("holdings_account_symbol").on(t.accountId, t.symbol)]
)

/** Exchange rates as the ECB publishes them: units of `currency` per 1 EUR on `date`. */
export const fxRates = sqliteTable(
  "fx_rates",
  {
    date: text().notNull(),
    currency: text().notNull(),
    rate: real().notNull(),
  },
  (t) => [primaryKey({ columns: [t.currency, t.date] })]
)

/** Who changed what: one row per write, in the same database transaction as the write. */
export const changes = sqliteTable(
  "changes",
  {
    id: integer().primaryKey(),
    at: text()
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    /** "person", "mcp:<client name>", "bank-sync:<bank>", "ibkr", "import:<file>" or "demo". */
    actor: text().notNull(),
    action: text({ enum: ["create", "update", "delete"] }).notNull(),
    entity: text().notNull(),
    entityId: integer("entity_id"),
    summary: text().notNull(),
    /**
     * The id of the first change written by the same data-layer call (or the
     * same sync or import run): one batch is one entry in Activity.
     */
    batch: integer(),
    /** What changed on the entity alone, e.g. "Category set to Groceries", for its history. */
    detail: text(),
  },
  (t) => [
    index("changes_at").on(t.at),
    index("changes_batch").on(t.batch),
    index("changes_entity").on(t.entity, t.entityId),
  ]
)
export * from "./schema-jobs"
export * from "./schema-tokens"
export * from "./schema-ibkr"
