ALTER TABLE `wardrobe_items` ADD COLUMN `fit` text DEFAULT 'Regular' NOT NULL;
--> statement-breakpoint
ALTER TABLE `wardrobe_items` ADD COLUMN `occasions` text DEFAULT '[]' NOT NULL;
