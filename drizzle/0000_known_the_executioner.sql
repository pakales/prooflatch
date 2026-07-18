CREATE TABLE `ai_quota_usage` (
	`subject_hash` text PRIMARY KEY NOT NULL,
	`minute_window` integer NOT NULL,
	`minute_count` integer NOT NULL,
	`day_window` integer NOT NULL,
	`day_count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_quota_usage_expires_at_idx` ON `ai_quota_usage` (`expires_at`);