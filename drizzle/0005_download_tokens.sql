ALTER TABLE `paid_files` ADD `download_price` text;--> statement-breakpoint
CREATE TABLE `download_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`file_key` text NOT NULL,
	`payment_tx` text,
	`payment_address` text,
	`private_key` text,
	`payment_amount` text,
	`downloads_used` integer DEFAULT 0 NOT NULL,
	`downloads_max` integer DEFAULT 3 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `dt_file_key_idx` ON `download_tokens` (`file_key`);--> statement-breakpoint
CREATE INDEX `dt_expires_at_idx` ON `download_tokens` (`expires_at`);
