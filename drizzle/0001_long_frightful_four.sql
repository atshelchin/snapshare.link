CREATE TABLE `paid_files` (
	`file_key` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`encrypted` integer DEFAULT 0 NOT NULL,
	`payment_tx` text,
	`payment_amount` text,
	`upload_id` text,
	`upload_status` text DEFAULT 'pending' NOT NULL,
	`parts_total` integer DEFAULT 0,
	`parts_done` integer DEFAULT 0,
	`uploader_hash_ip` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `paid_channel_id_idx` ON `paid_files` (`channel_id`);--> statement-breakpoint
CREATE INDEX `paid_upload_status_idx` ON `paid_files` (`upload_status`);--> statement-breakpoint
CREATE INDEX `paid_expires_at_idx` ON `paid_files` (`expires_at`);