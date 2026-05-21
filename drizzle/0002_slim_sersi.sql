ALTER TABLE `paid_files` ADD `order_id` text;--> statement-breakpoint
ALTER TABLE `paid_files` ADD `payment_address` text;--> statement-breakpoint
ALTER TABLE `paid_files` ADD `swept` integer DEFAULT 0 NOT NULL;