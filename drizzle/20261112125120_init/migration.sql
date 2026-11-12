CREATE TABLE `account_values` (
	`account_id` integer NOT NULL,
	`date` text NOT NULL,
	`value` integer NOT NULL,
	CONSTRAINT `account_values_pk` PRIMARY KEY(`account_id`, `date`),
	CONSTRAINT `fk_account_values_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`on_budget` integer NOT NULL,
	`closed` integer DEFAULT false NOT NULL,
	`provider` text,
	`external_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `budgets` (
	`month` text NOT NULL,
	`category_id` integer NOT NULL,
	`amount` integer NOT NULL,
	CONSTRAINT `budgets_pk` PRIMARY KEY(`month`, `category_id`),
	CONSTRAINT `fk_budgets_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY,
	`group_id` integer NOT NULL,
	`name` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_categories_group_id_category_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `category_groups`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `category_groups` (
	`id` integer PRIMARY KEY,
	`name` text NOT NULL,
	`is_income` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `changes` (
	`id` integer PRIMARY KEY,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` integer,
	`summary` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`date` text NOT NULL,
	`currency` text NOT NULL,
	`rate` real NOT NULL,
	CONSTRAINT `fx_rates_pk` PRIMARY KEY(`currency`, `date`)
);
--> statement-breakpoint
CREATE TABLE `holdings` (
	`id` integer PRIMARY KEY,
	`account_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`quantity` real NOT NULL,
	`price` real NOT NULL,
	`value` integer NOT NULL,
	`currency` text NOT NULL,
	`as_of` text NOT NULL,
	CONSTRAINT `fk_holdings_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `payees` (
	`id` integer PRIMARY KEY,
	`name` text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY,
	`account_id` integer NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`payee_id` integer,
	`category_id` integer,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'cleared' NOT NULL,
	`transfer_id` integer,
	`imported_id` text,
	`imported_payee` text,
	`booked_date` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT `fk_transactions_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_transactions_payee_id_payees_id_fk` FOREIGN KEY (`payee_id`) REFERENCES `payees`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_transactions_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_provider_external` ON `accounts` (`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `categories_group` ON `categories` (`group_id`);--> statement-breakpoint
CREATE INDEX `changes_at` ON `changes` (`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `holdings_account_symbol` ON `holdings` (`account_id`,`symbol`);--> statement-breakpoint
CREATE INDEX `transactions_account_date` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_date` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_category` ON `transactions` (`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_account_imported` ON `transactions` (`account_id`,`imported_id`);