CREATE TABLE `ibkr` (
	`id` integer PRIMARY KEY,
	`query_id` text,
	`last_report_at` text,
	`last_report_to` text,
	`last_pull_started_at` text,
	`last_pull_at` text,
	`last_error` text,
	`needs_person` integer DEFAULT false NOT NULL,
	`blocked_until` text,
	`missing_sections` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `holdings` ADD `asset_class` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `holdings` ADD `cost_basis` integer;--> statement-breakpoint
ALTER TABLE `holdings` ADD `unrealized_pnl` integer;