CREATE TABLE `login_attempts` (
	`email` text PRIMARY KEY NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer NOT NULL,
	`locked_until` integer
);
