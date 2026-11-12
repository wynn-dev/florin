CREATE TABLE `deleted_imports` (
	`account_id` integer NOT NULL,
	`imported_id` text NOT NULL,
	CONSTRAINT `deleted_imports_pk` PRIMARY KEY(`account_id`, `imported_id`),
	CONSTRAINT `fk_deleted_imports_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `key` text;--> statement-breakpoint
ALTER TABLE `changes` ADD `related_id` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_key` ON `categories` (`key`);--> statement-breakpoint
UPDATE `categories` SET `key` = 'starting-balances' WHERE `id` = (SELECT `c`.`id` FROM `categories` `c` JOIN `category_groups` `g` ON `g`.`id` = `c`.`group_id` WHERE `g`.`is_income` = 1 AND `c`.`name` = 'Starting balances' ORDER BY `c`.`id` LIMIT 1);--> statement-breakpoint
INSERT OR IGNORE INTO `settings` (`key`, `value`) SELECT 'defaultCategoriesAdded', '1' WHERE EXISTS (SELECT 1 FROM `category_groups`);
