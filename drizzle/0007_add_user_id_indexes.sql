CREATE INDEX IF NOT EXISTS idx_wardrobe_items_user ON wardrobe_items(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_saved_outfits_user ON saved_outfits(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_buy_analyses_user ON buy_analyses(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wear_logs_user ON wear_logs(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_item_challenges_user ON item_challenges(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tomorrow_plans_user ON tomorrow_plans(user_id);
