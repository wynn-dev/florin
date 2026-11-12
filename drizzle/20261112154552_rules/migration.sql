CREATE TABLE `rules` (
	`id` integer PRIMARY KEY,
	`pattern` text NOT NULL,
	`payee` text,
	`category_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_rules_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL
);
