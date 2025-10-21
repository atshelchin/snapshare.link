CREATE TABLE `files` (
	`channel_id` text,
	`file_key` text PRIMARY KEY NOT NULL,
	`file_name` text,
	`file_type` text,
	`file_size` integer,
	`uploader_hash_ip` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `channel_id_idx` ON `files` (`channel_id`);--> statement-breakpoint
CREATE INDEX `uploader_hash_ip_idx` ON `files` (`uploader_hash_ip`);--> statement-breakpoint
CREATE INDEX `created_at_idx` ON `files` (`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer,
	`name` text
);
