ALTER TABLE `changes` ADD `batch` integer;--> statement-breakpoint
ALTER TABLE `changes` ADD `detail` text;--> statement-breakpoint
CREATE INDEX `changes_batch` ON `changes` (`batch`);--> statement-breakpoint
CREATE INDEX `changes_entity` ON `changes` (`entity`,`entity_id`);--> statement-breakpoint
-- Changes logged before batches each stand alone.
UPDATE `changes` SET `batch` = `id` WHERE `batch` IS NULL;
