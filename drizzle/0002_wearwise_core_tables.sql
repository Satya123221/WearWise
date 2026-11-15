DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  style_notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE wardrobe_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  slot TEXT NOT NULL,
  color TEXT NOT NULL,
  color_hex TEXT NOT NULL DEFAULT '#888888',
  pattern TEXT NOT NULL DEFAULT 'Solid',
  material TEXT NOT NULL DEFAULT 'Cotton',
  style TEXT NOT NULL DEFAULT 'Casual',
  season TEXT NOT NULL DEFAULT 'All Season',
  formality INTEGER NOT NULL DEFAULT 2,
  price REAL NOT NULL DEFAULT 0,
  worn_count INTEGER NOT NULL DEFAULT 0,
  last_worn_at INTEGER,
  favorite INTEGER NOT NULL DEFAULT 0,
  image_key TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE saved_outfits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  item_ids TEXT NOT NULL,
  occasion TEXT NOT NULL DEFAULT '',
  match_score INTEGER NOT NULL DEFAULT 0,
  explanation TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE buy_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL,
  score INTEGER NOT NULL,
  reasons TEXT NOT NULL DEFAULT '[]',
  cautions TEXT NOT NULL DEFAULT '[]',
  verdict_text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
