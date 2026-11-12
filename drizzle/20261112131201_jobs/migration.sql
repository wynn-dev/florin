CREATE TABLE `jobs` (
	`name` text PRIMARY KEY,
	`last_started_at` text,
	`last_success_at` text,
	`last_error` text,
	`next_due_at` text
);
