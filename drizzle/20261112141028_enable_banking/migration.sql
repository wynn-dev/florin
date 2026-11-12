CREATE TABLE `eb_accounts` (
	`id` integer PRIMARY KEY,
	`link_id` integer NOT NULL,
	`uid` text NOT NULL,
	`identification_hash` text NOT NULL,
	`hashes` text DEFAULT '[]' NOT NULL,
	`name` text NOT NULL,
	`identifier` text NOT NULL,
	`currency` text NOT NULL,
	`kind` text NOT NULL,
	`account_id` integer UNIQUE,
	`last_synced_at` text,
	`last_booked_date` text,
	`next_attempt_at` text,
	`bank_balance` integer,
	`bank_balance_at` text,
	`set_opening` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_eb_accounts_link_id_eb_links_id_fk` FOREIGN KEY (`link_id`) REFERENCES `eb_links`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_eb_accounts_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `eb_links` (
	`id` integer PRIMARY KEY,
	`session_id` text NOT NULL UNIQUE,
	`bank` text NOT NULL,
	`country` text NOT NULL,
	`valid_until` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_sync_at` text,
	`last_attempt_at` text,
	`last_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `eb_pending` (
	`state` text PRIMARY KEY,
	`bank` text NOT NULL,
	`country` text NOT NULL,
	`link_id` integer,
	`return_to` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `eb_settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eb_accounts_link_hash` ON `eb_accounts` (`link_id`,`identification_hash`);