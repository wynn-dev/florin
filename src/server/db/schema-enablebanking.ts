// Bank sync through Enable Banking (src/server/enablebanking/). A link is one
// authorised Enable Banking session with one bank; its bank accounts each feed
// at most one florin account. Bank accounts are keyed by the bank's
// identification hash, which stays the same across renewals, so a renewed link
// keeps its mapping. Times are ISO timestamps, UTC.
import { sql } from "drizzle-orm"
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { accounts } from "./schema"

/** Bank sync settings, one row per key (the sync interval). */
export const ebSettings = sqliteTable("eb_settings", {
  key: text().primaryKey(),
  value: text().notNull(),
})

/** An authorisation started in florin and not yet back from the bank. */
export const ebPending = sqliteTable("eb_pending", {
  /** The random state sent to Enable Banking and checked on the way back. */
  state: text().primaryKey(),
  bank: text().notNull(),
  country: text().notNull(),
  /** Set when renewing an existing link. */
  linkId: integer("link_id"),
  /** Where the browser goes once the link is made. */
  returnTo: text("return_to").notNull(),
  createdAt: text("created_at").notNull(),
})

export const ebLinks = sqliteTable("eb_links", {
  id: integer().primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  bank: text().notNull(),
  country: text().notNull(),
  validUntil: text("valid_until").notNull(),
  status: text({ enum: ["active", "expired", "revoked"] })
    .notNull()
    .default("active"),
  /** The last sync that went through (fully or for some accounts). */
  lastSyncAt: text("last_sync_at"),
  /** The last sync tried, whatever came of it; the schedule counts from here. */
  lastAttemptAt: text("last_attempt_at"),
  /** The last sync's error in plain words; null once a sync goes fine. */
  lastError: text("last_error"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
})

export const ebAccounts = sqliteTable(
  "eb_accounts",
  {
    id: integer().primaryKey(),
    linkId: integer("link_id")
      .notNull()
      .references(() => ebLinks.id, { onDelete: "cascade" }),
    /** The account's id in the current session; changes on every renewal. */
    uid: text().notNull(),
    /** The bank account's stable id across sessions. */
    identificationHash: text("identification_hash").notNull(),
    /** Every hash the bank gave for the account (JSON list), for matching on renewal. */
    hashes: text().notNull().default("[]"),
    name: text().notNull(),
    /** IBAN or masked card number, masked for display. */
    identifier: text().notNull(),
    currency: text().notNull(),
    kind: text().notNull(),
    accountId: integer("account_id")
      .unique()
      .references(() => accounts.id, { onDelete: "set null" }),
    lastSyncedAt: text("last_synced_at"),
    /** The newest booking date seen; the next sync fetches from a little before it. */
    lastBookedDate: text("last_booked_date"),
    /** No sync before this time (set after the bank's rate limit). */
    nextAttemptAt: text("next_attempt_at"),
    bankBalance: integer("bank_balance"),
    bankBalanceAt: text("bank_balance_at"),
    /** A new florin account made for this bank account: its first sync sets the opening balance. */
    setOpening: integer("set_opening", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => [
    uniqueIndex("eb_accounts_link_hash").on(t.linkId, t.identificationHash),
  ]
)
