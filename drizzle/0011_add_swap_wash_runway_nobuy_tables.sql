ALTER TABLE `wardrobe_items` ADD COLUMN `wears_since_wash` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `wardrobe_items` SET `wears_since_wash` = `worn_count`;
--> statement-breakpoint
CREATE TABLE `loans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`borrower` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`lent_at` integer NOT NULL,
	`due_at` integer NOT NULL,
	`returned_at` integer
);
--> statement-breakpoint
CREATE INDEX `loans_user_id_idx` ON `loans` (`user_id`);
--> statement-breakpoint
CREATE TABLE `no_buy_challenges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`target_days` integer DEFAULT 30 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `no_buy_challenges_user_id_idx` ON `no_buy_challenges` (`user_id`);
--> statement-breakpoint
CREATE TABLE `resisted_purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`challenge_id` integer NOT NULL,
	`label` text NOT NULL,
	`price` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `resisted_purchases_user_id_idx` ON `resisted_purchases` (`user_id`);
--> statement-breakpoint
CREATE TABLE `runway_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`title` text NOT NULL,
	`days_json` text NOT NULL,
	`checklist_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runway_plans_user_id_idx` ON `runway_plans` (`user_id`);
