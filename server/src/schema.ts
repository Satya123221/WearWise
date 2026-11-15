import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  styleNotes: text("style_notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const wardrobeItems = sqliteTable("wardrobe_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  brand: text("brand").notNull().default(""),
  productUrl: text("product_url"),
  retailer: text("retailer").notNull().default(""),
  name: text("name").notNull(),
  category: text("category").notNull(),
  slot: text("slot").notNull(), // top | bottom | shoes | outerwear | accessory | ethnic
  color: text("color").notNull(),
  colorHex: text("color_hex").notNull().default("#888888"),
  pattern: text("pattern").notNull().default("Solid"),
  material: text("material").notNull().default("Cotton"),
  style: text("style").notNull().default("Casual"),
  fit: text("fit").notNull().default("Regular"), // Slim | Regular | Relaxed | Oversized
  occasions: text("occasions").notNull().default("[]"), // JSON string[] of occasion labels
  season: text("season").notNull().default("All Season"),
  formality: integer("formality").notNull().default(2), // 1 casual .. 5 formal
  price: real("price").notNull().default(0), // selling / price paid (₹)
  mrp: real("mrp"), // Indian MRP (₹) when listed; null = no MRP/discount listed
  wornCount: integer("worn_count").notNull().default(0),
  lastWornAt: integer("last_worn_at", { mode: "timestamp_ms" }),
  favorite: integer("favorite").notNull().default(0),
  imageKey: text("image_key"), // hero | overshirt | blacktee | null (color tile)
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const savedOutfits = sqliteTable("saved_outfits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  itemIds: text("item_ids").notNull(), // JSON array of item ids
  occasion: text("occasion").notNull().default(""),
  matchScore: integer("match_score").notNull().default(0),
  explanation: text("explanation").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const buyAnalyses = sqliteTable("buy_analyses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  productName: text("product_name").notNull(),
  price: real("price").notNull().default(0),
  mrp: real("mrp"),
  verdict: text("verdict").notNull(), // BUY | CONSIDER | SKIP
  score: integer("score").notNull(),
  reasons: text("reasons").notNull().default("[]"), // JSON string[]
  cautions: text("cautions").notNull().default("[]"),
  verdictText: text("verdict_text").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* Repeat Radar: one row per outfit actually worn, with the social
   context (occasion / audience / location) a plain wear count can't
   carry. Repeat warnings are computed from these rows at read time. */
export const wearLogs = sqliteTable("wear_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  itemIds: text("item_ids").notNull(), // JSON array of wardrobe item ids
  occasion: text("occasion").notNull().default(""),
  audience: text("audience").notNull().default(""), // who saw it — "College friends", "Placement panel"…
  location: text("location").notNull().default(""),
  wornAt: integer("worn_at", { mode: "timestamp_ms" }).notNull(),
});

/* One Item, 7 Ways: the active 30-day challenge for one neglected piece.
   Progress (wears logged, streak) is stored because it is user action
   history, not derivable from the wardrobe rows alone. */
export const itemChallenges = sqliteTable("item_challenges", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  itemId: integer("item_id").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  targetDays: integer("target_days").notNull().default(30),
  targetWears: integer("target_wears").notNull().default(7),
  wearsLogged: integer("wears_logged").notNull().default(0),
  streak: integer("streak").notNull().default(0),
  lastWearAt: integer("last_wear_at", { mode: "timestamp_ms" }),
  status: text("status").notNull().default("active"), // active | completed
});

/* Tomorrow, Laid Out: tonight's saved plan for tomorrow's date
   (planDate = YYYY-MM-DD of the day the outfit is FOR). One plan per
   user per date; laying out again replaces that date's plan. */
export const tomorrowPlans = sqliteTable("tomorrow_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  planDate: text("plan_date").notNull(),
  occasion: text("occasion").notNull().default(""),
  weatherLabel: text("weather_label").notNull().default(""),
  itemIds: text("item_ids").notNull(), // JSON array of wardrobe item ids
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const feedback = sqliteTable("feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  kind: text("kind").notNull(), // worn | saved | liked | skipped
  detail: text("detail").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
