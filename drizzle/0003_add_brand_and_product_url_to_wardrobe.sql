ALTER TABLE wardrobe_items ADD COLUMN brand TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE wardrobe_items ADD COLUMN product_url TEXT;
--> statement-breakpoint
ALTER TABLE wardrobe_items ADD COLUMN retailer TEXT NOT NULL DEFAULT '';
