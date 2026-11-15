CREATE TABLE `wear_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`item_ids` text NOT NULL,
	`occasion` text DEFAULT '' NOT NULL,
	`audience` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`worn_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_challenges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`target_days` integer DEFAULT 30 NOT NULL,
	`target_wears` integer DEFAULT 7 NOT NULL,
	`wears_logged` integer DEFAULT 0 NOT NULL,
	`streak` integer DEFAULT 0 NOT NULL,
	`last_wear_at` integer,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tomorrow_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`plan_date` text NOT NULL,
	`occasion` text DEFAULT '' NOT NULL,
	`weather_label` text DEFAULT '' NOT NULL,
	`item_ids` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
