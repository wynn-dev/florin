CREATE TABLE `mcp_tokens` (
	`id` integer PRIMARY KEY,
	`name` text NOT NULL UNIQUE,
	`token_hash` text NOT NULL UNIQUE,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_used_at` text
);
