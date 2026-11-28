// WearWise server actions — the "AI service layer".
//
// Every intelligence feature the brief asks for (analyzeClothing,
// generateOutfit, analyzePurchase, calculateWardrobeMatch, getStyleProfile,
// getWardrobeInsights, recommendProducts) is a typed action here, computed
// deterministically from the user's real wardrobe rows. The scoring engine
// is transparent: every score ships with its factor breakdown so the UI can
// explain *why*. These handlers are the seam where a real FastAPI / vision
// backend would later be swapped in — the client contract would not change.

import { defineAction, z, type ActionsModule, type Ctx, type SpaceDb } from "@hatch/space-sdk";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import * as schema from "./schema";

/* ------------------------------------------------------------------ */
/* Shared types                                                        */
/* ------------------------------------------------------------------ */

const itemSchema = z.object({
  id: z.number(),
  brand: z.string(),
  productUrl: z.string().nullable(),
  retailer: z.string(),
  name: z.string(),
  category: z.string(),
  slot: z.string(),
  color: z.string(),
  colorHex: z.string(),
  pattern: z.string(),
  material: z.string(),
  style: z.string(),
  fit: z.string(),
  occasions: z.array(z.string()),
  season: z.string(),
  formality: z.number(),
  price: z.number(),
  mrp: z.number().nullable(),
  discountPct: z.number(),
  wornCount: z.number(),
  lastWornAt: z.string().nullable(),
  daysSinceWorn: z.number().nullable(),
  costPerWear: z.number(),
  favorite: z.boolean(),
  imageKey: z.string().nullable(),
  /* URL of the user's own uploaded photo for this piece, resolved
     from blob storage at read time; null when the piece has no saved
     photo (or the stored photo is missing) → colour tile / imageKey. */
  photoUrl: z.string().nullable(),
  outfitCount: z.number(),
});
type ItemOut = z.infer<typeof itemSchema>;

const outfitSchema = z.object({
  title: z.string(),
  items: z.array(itemSchema),
  matchScore: z.number(),
  explanation: z.string(),
  factors: z.array(z.object({ label: z.string(), score: z.number() })),
});

/* ------------------------------------------------------------------ */
/* Real branded wardrobe (seeded once per new account)                */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000;
const now = () => Date.now();

/* Real branded wardrobe — every piece is a real product sold in India,
   sourced from the live Meta Catalog (prices = listed sale price on
   13 Nov 2026). `mrp` is the catalog's list price (its `price` field,
   shown as "was ₹X" beside a sale price) for the same product page,
   re-checked 13 Nov 2026; mrp is null where the catalog listed no
   higher list price for that product, so no discount is ever invented.
   productUrl is the retailer's own product page, copied
   from the catalog result (fbclid tracking stripped). Wear counts are
   the demo owner's wear history layered on the real products, so
   cost-per-wear and analytics stay personal and editable. */
type RealItem = {
  brand: string; retailer: string; productUrl: string;
  name: string; category: string; slot: string; color: string; colorHex: string;
  pattern: string; material: string; style: string; season: string; formality: number;
  price: number; mrp: number | null; wornCount: number; daysAgo: number | null; favorite: number; imageKey: string | null;
};
const REAL_WARDROBE: RealItem[] = [
  { brand: "Tommy Hilfiger", retailer: "Ajio", productUrl: "https://www.ajio.com/tommy-hilfiger-men-relaxed-fit-short-sleeve-oxford-shirt/p/469721098_ecru?&linkcohort=premium", name: "Relaxed Fit Oxford Shirt — Ecru", category: "Shirt", slot: "top", color: "Cream", colorHex: "#e8ddc8", pattern: "Solid", material: "Cotton Oxford", style: "Smart Casual", season: "All Season", formality: 3, price: 2000, mrp: 3999, wornCount: 24, daysAgo: 2, favorite: 1, imageKey: "hero" },
  { brand: "Allen Solly", retailer: "Nykaa Man", productUrl: "https://www.nykaaman.com/allen-solly-men-royal-blue-slim-fit-solid-full-sleeves-formal-shirt/p/16843563?ptype=product&skuId=16843215", name: "Slim Fit Formal Shirt — Royal Blue", category: "Shirt", slot: "top", color: "Blue", colorHex: "#2b4f9e", pattern: "Solid", material: "Cotton", style: "Classic", season: "All Season", formality: 4, price: 1763, mrp: 2799, wornCount: 18, daysAgo: 5, favorite: 0, imageKey: null },
  { brand: "H&M", retailer: "Nykaa Fashion", productUrl: "https://www.nykaafashion.com/h-m-regular-fit-oxford-shirt-white/p/23368278?adsource=shopping_india", name: "Regular Fit Oxford Shirt — White", category: "Shirt", slot: "top", color: "White", colorHex: "#f4f1ea", pattern: "Solid", material: "Cotton Oxford", style: "Classic", season: "All Season", formality: 3, price: 1799, mrp: null, wornCount: 21, daysAgo: 3, favorite: 1, imageKey: null },
  { brand: "PUMA", retailer: "Puma India", productUrl: "https://in.puma.com/in/en/pd/t7-mens-tee/629592?size=0160&swatch=36", name: "T7 Tee — Black", category: "T-Shirt", slot: "top", color: "Black", colorHex: "#1b1b1e", pattern: "Solid", material: "Cotton Jersey", style: "Streetwear", season: "Summer", formality: 1, price: 2499, mrp: null, wornCount: 19, daysAgo: 4, favorite: 1, imageKey: "blacktee" },
  { brand: "DaMENSCH", retailer: "DaMENSCH", productUrl: "https://www.damensch.com/p/statement-oversized-solid-t-shirt-urban-blue?s=2xl", name: "Statement Oversized T-Shirt — Urban Blue", category: "T-Shirt", slot: "top", color: "Blue", colorHex: "#3d5a80", pattern: "Solid", material: "Heavy Cotton", style: "Streetwear", season: "Summer", formality: 1, price: 1129, mrp: 1299, wornCount: 12, daysAgo: 6, favorite: 0, imageKey: null },
  { brand: "Mast & Harbour", retailer: "Myntra", productUrl: "http://www.myntra.com/Jackets/Mast+%26+Harbour/Mast--Harbour-Men-Navy-Pure-Cotton-Washed-Denim-Jacket/15507928/buy", name: "Washed Denim Jacket — Navy", category: "Jacket", slot: "outerwear", color: "Navy", colorHex: "#24365e", pattern: "Solid", material: "Denim", style: "Casual", season: "Winter", formality: 2, price: 927, mrp: 2899, wornCount: 3, daysAgo: 64, favorite: 0, imageKey: null },
  { brand: "Peter England", retailer: "Peter England", productUrl: "https://peterengland.abfrl.in/p/men-black-solid-slim-fit-formal-blazer-967631.html", name: "Slim Fit Formal Blazer — Black", category: "Blazer", slot: "outerwear", color: "Black", colorHex: "#1c1c20", pattern: "Solid", material: "Wool Blend", style: "Classic", season: "All Season", formality: 5, price: 5999, mrp: null, wornCount: 5, daysAgo: 21, favorite: 0, imageKey: null },
  { brand: "Marks & Spencer", retailer: "Marks & Spencer India", productUrl: "https://www.marksandspencer.in/slim-fit-jacquard-single-breasted-blazer/p/000000060732828029.html", name: "Slim Fit Jacquard Blazer — Teal Mix", category: "Blazer", slot: "outerwear", color: "Teal", colorHex: "#2e5f5d", pattern: "Jacquard", material: "Jacquard Weave", style: "Classic", season: "All Season", formality: 5, price: 3599, mrp: 8999, wornCount: 2, daysAgo: 45, favorite: 0, imageKey: null },
  { brand: "Levi's", retailer: "Levi's India", productUrl: "https://levi.in/products/mens-511-light-blue-slim-fit-mid-rise-jeans-182981895?variant=50742712336674", name: "511 Slim Fit Jeans — Light Blue", category: "Jeans", slot: "bottom", color: "Blue", colorHex: "#7d9bbd", pattern: "Solid", material: "Stretch Denim", style: "Casual", season: "All Season", formality: 2, price: 1889, mrp: 4799, wornCount: 31, daysAgo: 3, favorite: 1, imageKey: null },
  { brand: "Being Human", retailer: "Being Human", productUrl: "https://www.beinghumanclothing.com/products/being-human-clothing-men-beige-self-design-trouser-bhndc25000-dk-beige", name: "Cropped Fit Chinos — Beige", category: "Chinos", slot: "bottom", color: "Beige", colorHex: "#cbb894", pattern: "Solid", material: "Cotton Twill", style: "Smart Casual", season: "All Season", formality: 3, price: 1015, mrp: 2899, wornCount: 28, daysAgo: 2, favorite: 1, imageKey: null },
  { brand: "Jack & Jones", retailer: "Nykaa Man", productUrl: "https://www.nykaaman.com/jack-jones-men-dark-blue-washed-straight-fit-jeans/p/28130095?ptype=product&skuId=28129909", name: "Washed Straight Fit Jeans — Dark Blue", category: "Jeans", slot: "bottom", color: "Blue", colorHex: "#2c4460", pattern: "Washed", material: "Denim", style: "Casual", season: "All Season", formality: 2, price: 1799, mrp: 2999, wornCount: 16, daysAgo: 8, favorite: 0, imageKey: null },
  { brand: "GUESS", retailer: "Guess India", productUrl: "https://guess.in/product/black-solid-lace-up-sneakers-16791576", name: "Leather Lace-Up Sneakers — Black", category: "Sneakers", slot: "shoes", color: "Black", colorHex: "#17171a", pattern: "Solid", material: "Leather", style: "Minimal", season: "All Season", formality: 2, price: 4500, mrp: null, wornCount: 42, daysAgo: 3, favorite: 1, imageKey: null },
  { brand: "Pepe Jeans", retailer: "Pepe Jeans India", productUrl: "https://www.pepejeans.in/men-white-anti-skid-outsole-sneakers/8905875568315.html", name: "Anti-Skid Sneakers — White", category: "Sneakers", slot: "shoes", color: "White", colorHex: "#f2f0eb", pattern: "Solid", material: "Leather & Mesh", style: "Minimal", season: "All Season", formality: 2, price: 2199, mrp: 5499, wornCount: 35, daysAgo: 1, favorite: 1, imageKey: null },
  { brand: "Reebok", retailer: "Reebok India", productUrl: "https://reebok.abfrl.in/p/courtswift-merton-40542630.html", name: "Courtswift Merton Sneakers — Black", category: "Sneakers", slot: "shoes", color: "Black", colorHex: "#202024", pattern: "Solid", material: "Vegan Leather", style: "Sporty", season: "All Season", formality: 1, price: 3219, mrp: 4599, wornCount: 14, daysAgo: 5, favorite: 0, imageKey: null },
  { brand: "Nike", retailer: "Nike India", productUrl: "https://www.nike.in/nike-revolution-8-easyon-men-s-road-running-shoes/p/24932946", name: "Revolution 8 EasyOn Running Shoes — Black", category: "Running Shoes", slot: "shoes", color: "Black", colorHex: "#232326", pattern: "Solid", material: "Mesh", style: "Sporty", season: "All Season", formality: 1, price: 4295, mrp: null, wornCount: 22, daysAgo: 2, favorite: 0, imageKey: null },
  { brand: "Adidas", retailer: "Decathlon India", productUrl: "https://www.decathlon.in/p/1000004810/adidas-questar-3-m-men-running-shoes-black", name: "Questar 3 Running Shoes — Black", category: "Running Shoes", slot: "shoes", color: "Black", colorHex: "#26262b", pattern: "Solid", material: "Mesh", style: "Sporty", season: "All Season", formality: 1, price: 3999, mrp: null, wornCount: 9, daysAgo: 11, favorite: 0, imageKey: null },
  { brand: "Manyavar", retailer: "Nykaa Man", productUrl: "https://www.nykaaman.com/manyavar-men-s-aqua-blue-kurta-with-churidar/p/13499435?ptype=product&skuId=13496903", name: "Kurta with Churidar — Aqua Blue", category: "Kurta", slot: "ethnic", color: "Blue", colorHex: "#5b84ae", pattern: "Solid", material: "Cotton Blend", style: "Traditional", season: "All Season", formality: 4, price: 3999, mrp: null, wornCount: 4, daysAgo: 38, favorite: 0, imageKey: null },
  { brand: "FabIndia", retailer: "Ajio", productUrl: "https://www.ajio.com/fabindia-long-kurta-with-band-collar/p/465746300_green?&linkcohort=premium", name: "Long Kurta with Band Collar — Green", category: "Kurta", slot: "ethnic", color: "Green", colorHex: "#4f6b4a", pattern: "Solid", material: "Cotton", style: "Traditional", season: "All Season", formality: 4, price: 750, mrp: 2499, wornCount: 6, daysAgo: 27, favorite: 0, imageKey: null },
  { brand: "Pantaloons", retailer: "Pantaloons", productUrl: "https://pantaloons.com/p/blue-printed-below-waist-casual-men-regular-fit-kurta-1030083.html", name: "Indus Route Printed Kurta — Blue", category: "Kurta", slot: "ethnic", color: "Blue", colorHex: "#33506e", pattern: "Printed", material: "Woven Cotton", style: "Traditional", season: "All Season", formality: 3, price: 760, mrp: 999, wornCount: 3, daysAgo: 52, favorite: 0, imageKey: null },
  { brand: "U.S. Polo Assn.", retailer: "Nykaa Fashion", productUrl: "https://www.nykaafashion.com/u-s-polo-assn-colour-block-oxford-shirt/p/8921200?adsource=shopping_india", name: "Colour Block Oxford Shirt — Blue", category: "Shirt", slot: "top", color: "Blue", colorHex: "#4a6fa5", pattern: "Colour Block", material: "Cotton Oxford", style: "Smart Casual", season: "All Season", formality: 3, price: 2001, mrp: 2899, wornCount: 11, daysAgo: 9, favorite: 0, imageKey: null },
  { brand: "MR.BUTTON", retailer: "Ajio", productUrl: "https://ajio.com/mrbutton-men-slim-fit-blazer/p/701188074_grey", name: "Slim Fit Blazer — Grey", category: "Blazer", slot: "outerwear", color: "Grey", colorHex: "#8a8a8f", pattern: "Solid", material: "Velvet Blend", style: "Classic", season: "Winter", formality: 5, price: 4834, mrp: 6495, wornCount: 2, daysAgo: 58, favorite: 0, imageKey: null },
  { brand: "Allen Solly", retailer: "Nykaa Man", productUrl: "https://www.nykaaman.com/allen-solly-men-olive-solid-full-sleeves-casual-shirt/p/23872468?ptype=product&skuId=23872126", name: "Casual Shirt — Olive", category: "Shirt", slot: "top", color: "Olive", colorHex: "#5c6644", pattern: "Solid", material: "Cotton", style: "Casual", season: "All Season", formality: 2, price: 1949, mrp: 2499, wornCount: 6, daysAgo: 27, favorite: 0, imageKey: null },
  { brand: "Van Heusen", retailer: "Myntra", productUrl: "http://www.myntra.com/Trousers/Van+Heusen/Van-Heusen-Men-Mid-Rise-Regular-Fit-Formal-Trousers/46997400/buy", name: "Mid-Rise Formal Trousers — Charcoal", category: "Trousers", slot: "bottom", color: "Charcoal", colorHex: "#3a3a40", pattern: "Solid", material: "Poly-Viscose", style: "Classic", season: "All Season", formality: 4, price: 2936, mrp: 3299, wornCount: 8, daysAgo: 15, favorite: 0, imageKey: null },
  { brand: "Roadster", retailer: "Myntra", productUrl: "http://www.myntra.com/Tshirts/Roadster/Roadster-Men-Printed-T-shirt/44574625/buy", name: "Printed T-Shirt — Green", category: "T-Shirt", slot: "top", color: "Green", colorHex: "#3f6212", pattern: "Printed", material: "Cotton", style: "Casual", season: "Summer", formality: 1, price: 308, mrp: 799, wornCount: 13, daysAgo: 7, favorite: 0, imageKey: null },
];


/* ------------------------------------------------------------------ */
/* Scoring engine                                                      */
/* ------------------------------------------------------------------ */

const NEUTRALS = new Set(["black", "white", "navy", "beige", "grey", "gray", "cream", "charcoal", "olive", "brown", "silver"]);
const WARM: Record<string, string[]> = {
  Cold: ["Winter", "All Season"], Cool: ["Winter", "All Season"],
  Warm: ["All Season", "Summer"], Hot: ["Summer", "All Season"], Rainy: ["All Season", "Winter"],
};
const OCCASION_FORMALITY: Record<string, [number, number]> = {
  College: [1, 3], Casual: [1, 3], "Casual Outing": [1, 3], Date: [2, 4], Party: [2, 4],
  Interview: [4, 5], "Placement Interview": [4, 5], Wedding: [4, 5], Festive: [3, 5],
  Travel: [1, 3], Gym: [1, 1], Work: [3, 4],
  Diwali: [3, 5], Eid: [3, 5], "Traditional Event": [3, 5], "Family Function": [2, 4],
};

function colorScore(items: Array<{ color: string }>): number {
  if (items.length === 0) return 0;
  const neutrals = items.filter((i) => NEUTRALS.has(i.color.toLowerCase())).length;
  const distinct = new Set(items.map((i) => i.color.toLowerCase())).size;
  let s = 55 + neutrals * 9;
  if (distinct > 3) s -= (distinct - 3) * 8; // clashing risk
  return Math.max(30, Math.min(98, s));
}

/* Indian price math: discount % off MRP, only when a real MRP above the
   selling price is known. 0 means "no discount listed" — never invented. */
function discountPctOf(price: number, mrp: number | null | undefined): number {
  if (!mrp || mrp <= price || price <= 0) return 0;
  return Math.round((1 - price / mrp) * 100);
}

/* Occasions a piece plausibly serves, derived from its formality band —
   the same OCCASION_FORMALITY table the outfit engine scores against.
   Used when a row carries no user-confirmed occasions yet (seed rows,
   pre-fit/occasions rows), so every surface agrees on the derivation. */
function occasionsForFormality(formality: number): string[] {
  return Object.entries(OCCASION_FORMALITY)
    .filter(([, [lo, hi]]) => formality >= lo && formality <= hi)
    .map(([occ]) => occ)
    .slice(0, 5);
}

function parseOccasions(row: typeof schema.wardrobeItems.$inferSelect): string[] {
  try {
    const parsed = JSON.parse(row.occasions || "[]") as unknown;
    if (Array.isArray(parsed)) {
      const list = parsed.filter((o): o is string => typeof o === "string" && o.length > 0).slice(0, 8);
      if (list.length) return list;
    }
  } catch { /* fall through to the formality derivation */ }
  return occasionsForFormality(row.formality);
}

/* ------------------------------------------------------------------ */
/* Uploaded wardrobe photos (migration 0010)                           */
/*                                                                     */
/* The photo a user uploads in Add Clothing is downscaled client-side  */
/* (max 1200px, JPEG) and sent as base64. The server re-validates the  */
/* bytes itself — magic-byte sniffing, never the claimed file type —   */
/* and stores them in blob storage under a per-user key. Only the key  */
/* is kept on the wardrobe row, and photo URLs are resolved inside     */
/* session-gated actions, so a photo is only ever visible to the       */
/* account that uploaded it. The photo is stored as-is: the scan       */
/* remains a labelled starting guess and never "reads" the image.      */
/* ------------------------------------------------------------------ */

const photoArg = z.object({
  dataBase64: z.string().min(1).max(2_800_000),
  mimeType: z.string().max(60),
});
type PhotoArg = z.infer<typeof photoArg>;

const MAX_PHOTO_BYTES = 2_000_000; // ~2 MB decoded; the client downscales to well under this

function sniffImageType(bytes: Uint8Array): { contentType: string; ext: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { contentType: "image/png", ext: "png" };
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { contentType: "image/webp", ext: "webp" };
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { contentType: "image/gif", ext: "gif" };
  }
  return null;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* Validates and stores one uploaded photo; returns its blob key.
   Throws a user-readable error for anything that isn't a real image. */
async function storePhoto(ctx: Ctx, userId: number, photo: PhotoArg): Promise<string> {
  let bytes: Uint8Array;
  try {
    const bin = atob(photo.dataBase64.replace(/\s+/g, ""));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    throw new Error("That photo couldn't be read — try uploading it again.");
  }
  if (bytes.length === 0) throw new Error("That photo couldn't be read — try uploading it again.");
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new Error("That photo is too large to save — try a smaller one.");
  }
  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    throw new Error("That file doesn't look like a photo — upload a JPEG, PNG or WebP image.");
  }
  const key = `wardrobe-photos/u${userId}/${randomHex(12)}.${sniffed.ext}`;
  await ctx.blobs.put(key, bytes, { contentType: sniffed.contentType });
  return key;
}

async function deletePhotoBlob(ctx: Ctx, key: string | null | undefined): Promise<void> {
  if (!key) return;
  try { await ctx.blobs.delete(key); } catch { /* already gone — nothing to clean up */ }
}

/* Deletes every stored photo blob belonging to one user. Called before
   any action that wipes the wardrobe wholesale (demo reset, real-
   wardrobe upgrade, Delete My Data) so photos never outlive their rows. */
async function deleteAllUserPhotoBlobs(ctx: Ctx, userId: number): Promise<void> {
  const db = ctx.db<typeof schema>();
  const rows = await db.select({ photoBlobKey: schema.wardrobeItems.photoBlobKey })
    .from(schema.wardrobeItems)
    .where(eq(schema.wardrobeItems.userId, userId));
  for (const r of rows) await deletePhotoBlob(ctx, r.photoBlobKey);
}

/* Resolves a stored photo key to a servable URL, or null when the blob
   is missing/corrupt — the item then falls back to its colour tile. */
async function photoUrlFor(ctx: Ctx, key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  try {
    const meta = await ctx.blobs.head(key);
    if (!meta) return null;
    return await ctx.blobs.getUrl(key);
  } catch {
    return null;
  }
}

function toOut(
  row: typeof schema.wardrobeItems.$inferSelect,
  outfitCounts: Map<number, number>,
  photoUrl: string | null = null,
): ItemOut {
  const days = row.lastWornAt
    ? Math.floor((now() - row.lastWornAt.getTime()) / DAY)
    : null;
  return {
    id: row.id,
    brand: row.brand ?? "",
    productUrl: row.productUrl ?? null,
    retailer: row.retailer ?? "",
    name: row.name,
    category: row.category,
    slot: row.slot,
    color: row.color,
    colorHex: row.colorHex,
    pattern: row.pattern,
    material: row.material,
    style: row.style,
    fit: row.fit || "Regular",
    occasions: parseOccasions(row),
    season: row.season,
    formality: row.formality,
    price: row.price,
    mrp: row.mrp ?? null,
    discountPct: discountPctOf(row.price, row.mrp),
    wornCount: row.wornCount,
    lastWornAt: row.lastWornAt ? row.lastWornAt.toISOString() : null,
    daysSinceWorn: days,
    costPerWear: Math.round(row.price / Math.max(row.wornCount, 1)),
    favorite: row.favorite === 1,
    imageKey: row.imageKey,
    photoUrl,
    outfitCount: outfitCounts.get(row.id) ?? 0,
  };
}

async function loadItems(ctx: Ctx, userId: number): Promise<ItemOut[]> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.wardrobeItems)
    .where(eq(schema.wardrobeItems.userId, userId))
    .orderBy(desc(schema.wardrobeItems.createdAt));
  const outfits = await db
    .select()
    .from(schema.savedOutfits)
    .where(eq(schema.savedOutfits.userId, userId));
  const counts = new Map<number, number>();
  for (const o of outfits) {
    let ids: number[] = [];
    try { ids = JSON.parse(o.itemIds) as number[]; } catch { ids = []; }
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  /* outfitCount = real saved-outfit appearances + real potential pairings:
     the number of OTHER-slot pieces this item is colour-compatible with
     (either side neutral, or the same colour) — counted from the actual
     rows. Audit fix: this used to add a wear-count fudge
     (min(14, wornCount/3)) that presented an invented number as a pairing
     count in the UI, insights and ROI. Every consumer (versatility
     scoring, ROI potentialOutfits, dead-stock "pairs into N outfits",
     health's outfit-potential dimension) now reads a derivable number. */
  /* Uploaded photos: resolve each row's blob key to a URL here, inside
     this session-gated load, so the URL only ever reaches the owner.
     A missing/corrupt blob resolves to null and the item falls back
     to its imageKey / colour tile — it never breaks the wardrobe. */
  const photoUrls = new Map<number, string | null>();
  for (const r of rows) {
    if (r.photoBlobKey) photoUrls.set(r.id, await photoUrlFor(ctx, r.photoBlobKey));
  }
  const bases = rows.map((r) => toOut(r, counts, photoUrls.get(r.id) ?? null));
  return bases.map((base) => {
    const pairings = bases.filter((o) =>
      o.id !== base.id && o.slot !== base.slot &&
      (NEUTRALS.has(o.color.toLowerCase()) || NEUTRALS.has(base.color.toLowerCase()) ||
        o.color.toLowerCase() === base.color.toLowerCase()),
    ).length;
    return { ...base, outfitCount: base.outfitCount + pairings };
  });
}

/* The outfit engine's five-factor scorecard (Phase 5): colour, occasion,
   weather, style — plus Versatility, how widely the chosen pieces pair
   across the rest of the wardrobe (their real pairing counts + wear
   history). overallMatchScore is the weighted blend of all five. */
function versatilityOf(chosen: ItemOut[]): number {
  if (!chosen.length) return 0;
  return Math.round(
    chosen.reduce((a, i) => a + Math.min(96, 38 + i.outfitCount * 4 + Math.min(12, i.wornCount)), 0) / chosen.length,
  );
}

function outfitFactors(cScore: number, oScore: number, wScore: number, sScore: number, chosen: ItemOut[]) {
  const vScore = versatilityOf(chosen);
  return {
    total: Math.round(cScore * 0.25 + oScore * 0.25 + wScore * 0.15 + sScore * 0.2 + vScore * 0.15),
    factors: [
      { label: "Color harmony", score: cScore },
      { label: "Occasion match", score: oScore },
      { label: "Weather suitability", score: wScore },
      { label: "Style compatibility", score: sScore },
      { label: "Versatility", score: vScore },
    ],
  };
}

/* Personalization bias (Phase 6): styles parsed from the user's own
   outfit ratings — loved looks pull their style up, "not my style"
   looks push theirs down, inside the pick scoring only. */
export interface TasteBias { loved: string[]; disliked: string[] }

function styleFromFeedbackDetail(detail: string): string {
  // Feedback details store the outfit title "Occasion — Style", and
  // detailed feedback appends " · Reason: …" — strip the reason so the
  // style name still matches item styles in the taste bias exactly.
  return (detail.split("—")[1]?.trim() ?? "").split("· Reason:")[0]?.trim() ?? "";
}

function buildOutfit(
  items: ItemOut[],
  occasion: string,
  weather: string,
  style: string,
  seed: number,
  taste?: TasteBias,
): z.infer<typeof outfitSchema> {
  const [fMin, fMax] = OCCASION_FORMALITY[occasion] ?? [1, 4];
  const seasons = WARM[weather] ?? ["All Season"];
  const pick = (slot: string, pool: ItemOut[]): ItemOut | undefined => {
    const scored = pool
      .filter((i) => i.slot === slot)
      .map((i) => {
        let s = 50;
        if (i.formality >= fMin && i.formality <= fMax) s += 22; else s -= Math.abs(i.formality - (fMin + fMax) / 2) * 7;
        if (seasons.includes(i.season)) s += 12;
        if (style && i.style === style) s += 14;
        if (taste?.loved.includes(i.style)) s += 9; // you rated this style highly
        if (taste?.disliked.includes(i.style)) s -= 12; // "not my style"
        if (i.favorite) s += 4;
        if (NEUTRALS.has(i.color.toLowerCase())) s += 6;
        s += Math.min(10, i.wornCount / 4); // proven pieces
        s += ((seed * 31 + i.id * 17) % 13); // deterministic variety per "Try Another"
        return { i, s };
      })
      .sort((a, b) => b.s - a.s);
    return scored[0]?.i;
  };
  const chosen: ItemOut[] = [];
  const top = pick("top", items) ?? pick("ethnic", items);
  if (top) chosen.push(top);
  const bottom = pick("bottom", items);
  if (bottom && top?.slot !== "ethnic") chosen.push(bottom);
  const shoes = pick("shoes", items);
  if (shoes) chosen.push(shoes);
  if (weather === "Cold" || weather === "Cool" || weather === "Rainy") {
    const outer = pick("outerwear", items);
    if (outer) chosen.push(outer);
  }
  const acc = pick("accessory", items);
  if (acc) chosen.push(acc);

  const cScore = colorScore(chosen);
  const oScore = chosen.length
    ? Math.round(chosen.reduce((a, i) => a + (i.formality >= fMin && i.formality <= fMax ? 95 : 55), 0) / chosen.length)
    : 0;
  const wScore = chosen.length
    ? Math.round(chosen.reduce((a, i) => a + (seasons.includes(i.season) ? 94 : 58), 0) / chosen.length)
    : 0;
  const sScore = chosen.length
    ? Math.round(chosen.reduce((a, i) => a + (i.style === style ? 96 : i.style === "Casual" || i.style === "Smart Casual" ? 78 : 64), 0) / chosen.length)
    : 0;
  const { total, factors } = outfitFactors(cScore, oScore, wScore, sScore, chosen);
  const names = chosen.map((i) => i.name.toLowerCase()).join(", ");
  return {
    title: `${occasion} — ${style}`,
    items: chosen,
    matchScore: total,
    explanation: chosen.length
      ? `Built around ${names}. The palette stays in your proven neutrals, the formality lands right for ${occasion.toLowerCase()}, and every piece suits ${weather.toLowerCase()} weather.`
      : "Add a few more pieces to your wardrobe and WearWise can style complete outfits.",
    factors,
  };
}

/* Scores an already-chosen set of pieces (used by Remix, Transformer,
   Use-Again and Packing, which anchor outfits on a specific item). */
function scoreOutfitItems(
  chosen: ItemOut[],
  occasion: string,
  weather: string,
  style: string,
): z.infer<typeof outfitSchema> {
  const [fMin, fMax] = OCCASION_FORMALITY[occasion] ?? [1, 4];
  const seasons = WARM[weather] ?? ["All Season"];
  const cScore = colorScore(chosen);
  const avg = (fn: (i: ItemOut) => number) => (chosen.length ? Math.round(chosen.reduce((a, i) => a + fn(i), 0) / chosen.length) : 0);
  const oScore = avg((i) => (i.formality >= fMin && i.formality <= fMax ? 95 : 55));
  const wScore = avg((i) => (seasons.includes(i.season) ? 94 : 58));
  const sScore = avg((i) => (i.style === style ? 96 : i.style === "Casual" || i.style === "Smart Casual" ? 78 : 64));
  const { total, factors } = outfitFactors(cScore, oScore, wScore, sScore, chosen);
  const names = chosen.map((i) => i.name.toLowerCase()).join(", ");
  return {
    title: `${occasion} — ${style}`,
    items: chosen,
    matchScore: total,
    explanation: chosen.length
      ? `Built around ${names}. The palette stays in your proven neutrals, the formality lands right for ${occasion.toLowerCase()}, and every piece suits ${weather.toLowerCase()} weather.`
      : "Add a few more pieces to your wardrobe and WearWise can style complete outfits.",
    factors,
  };
}

/* Builds a complete outfit anchored on one specific owned item, filling
   the missing slots with the best-fitting complements. */
function buildAnchoredOutfit(
  items: ItemOut[],
  anchor: ItemOut,
  occasion: string,
  weather: string,
  style: string,
): z.infer<typeof outfitSchema> {
  const [fMin, fMax] = OCCASION_FORMALITY[occasion] ?? [1, 4];
  const chosen: ItemOut[] = [anchor];
  const need: string[] = anchor.slot === "ethnic"
    ? ["shoes"]
    : anchor.slot === "bottom" ? ["top", "shoes"]
      : anchor.slot === "shoes" ? ["top", "bottom"]
        : anchor.slot === "top" ? ["bottom", "shoes"]
          : ["top", "bottom", "shoes"]; // outerwear / accessory anchors still need a full base outfit under them
  for (const slot of need) {
    const pool = items
      .filter((i) => i.slot === slot && i.id !== anchor.id)
      .map((i) => {
        let s = 50;
        if (i.formality >= fMin && i.formality <= fMax) s += 22;
        if (NEUTRALS.has(i.color.toLowerCase())) s += 10;
        if (NEUTRALS.has(anchor.color.toLowerCase()) || i.color === anchor.color) s += 6;
        s += Math.min(10, i.wornCount / 4);
        return { i, s };
      })
      .sort((a, b) => b.s - a.s);
    if (pool[0]) chosen.push(pool[0].i);
  }
  // Order pieces top → bottom → shoes → layer for display.
  const order: Record<string, number> = { ethnic: 0, top: 0, outerwear: 1, bottom: 2, shoes: 3, accessory: 4 };
  chosen.sort((a, b) => (order[a.slot] ?? 5) - (order[b.slot] ?? 5));
  return scoreOutfitItems(chosen, occasion, weather, style);
}

/* Wardrobe gap analysis shared by the Analytics page and Ask WearWise:
   a gap is only claimed when the wardrobe genuinely lacks the piece,
   and potential combinations are counted from real owned items. */
function computeGaps(items: ItemOut[]): Array<{ title: string; reason: string; potentialCombos: number; slot: string; category: string }> {
  const gaps: Array<{ title: string; reason: string; potentialCombos: number; slot: string; category: string }> = [];
  const others = (slot: string) => items.filter((i) => i.slot !== slot);
  if (!items.some((i) => i.category.toLowerCase().includes("overshirt"))) {
    const combos = others("outerwear").filter((i) => i.slot === "top" || i.slot === "bottom").length;
    gaps.push({
      title: "Versatile overshirt",
      reason: `A beige overshirt would layer over your tees and shirts and work with ${combos} existing items — the single biggest variety unlock in your wardrobe.`,
      potentialCombos: combos, slot: "outerwear", category: "Overshirt",
    });
  }
  if (!items.some((i) => i.slot === "shoes" && i.color.toLowerCase() === "white")) {
    const combos = others("shoes").length;
    gaps.push({
      title: "White sneakers",
      reason: `Every top and bottom you own would gain a clean, bright option — white sneakers pair with ${combos} pieces across college, dates and travel.`,
      potentialCombos: combos, slot: "shoes", category: "Sneakers",
    });
  }
  if (!items.some((i) => i.slot === "bottom" && ["beige", "cream", "white"].includes(i.color.toLowerCase()))) {
    const combos = items.filter((i) => i.slot === "top" || i.slot === "ethnic").length;
    gaps.push({
      title: "Neutral trousers",
      reason: `Your bottoms lean dark and denim. A beige or cream trouser would unlock ${combos} lighter combinations, especially for interviews and festive days.`,
      potentialCombos: combos, slot: "bottom", category: "Trousers",
    });
  }
  if (!items.some((i) => i.category === "Hoodie")) {
    const combos = items.filter((i) => i.slot === "bottom" || i.slot === "shoes").length;
    gaps.push({
      title: "A go-to hoodie",
      reason: `You own no hoodie at all. One relaxed hoodie covers cold classrooms, travel days and gym commutes — and pairs with ${combos} bottoms and shoes you already own.`,
      potentialCombos: combos, slot: "top", category: "Hoodie",
    });
  }
  if (!items.some((i) => i.slot === "accessory")) {
    gaps.push({
      title: "Minimal watch or accessory",
      reason: "You own no accessories, so every outfit finishes one detail short. A minimal black watch completes smart looks without adding visual weight.",
      potentialCombos: items.length, slot: "accessory", category: "Accessory",
    });
  }
  if (!items.some((i) => i.slot === "ethnic")) {
    gaps.push({
      title: "Festive ethnic set",
      reason: "Weddings, Diwali and family functions have nothing to draw on yet. One kurta set covers the whole festive calendar.",
      potentialCombos: Math.max(3, items.filter((i) => i.slot === "shoes").length * 2), slot: "ethnic", category: "Kurta",
    });
  }
  return gaps.sort((a, b) => b.potentialCombos - a.potentialCombos).slice(0, 4);
}

/* ------------------------------------------------------------------ */
/* Unique features: Repeat Radar / 7 Ways / Dead Stock / Tomorrow /    */
/* Colour Season — all computed from the same wardrobe rows + the new  */
/* wear-log / challenge / tomorrow-plan tables.                        */
/* ------------------------------------------------------------------ */

function parseItemIds(raw: string): number[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];
  } catch { return []; }
}

/* Repeat overlap: two wears "repeat" for an audience when they share the
   outfit's core — the same top/ethnic piece AND the same bottom (or the
   exact same set, or ≥3 shared pieces for layered looks). */
function outfitsRepeat(a: number[], b: number[], byId: Map<number, ItemOut>): boolean {
  const setB = new Set(b);
  const shared = a.filter((id) => setB.has(id));
  if (shared.length === 0) return false;
  if (a.length === b.length && shared.length === a.length) return true;
  if (shared.length >= 3) return true;
  const core = (ids: number[]) => ({
    upper: ids.find((id) => ["top", "ethnic"].includes(byId.get(id)?.slot ?? "")),
    lower: ids.find((id) => byId.get(id)?.slot === "bottom"),
  });
  const ca = core(a); const cb = core(b);
  return Boolean(ca.upper && cb.upper && ca.upper === cb.upper && ca.lower && cb.lower && ca.lower === cb.lower);
}

const sameAudience = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim().length > 0;

/* Tomorrow's demo weather — deterministic by date so tonight's plan and
   tomorrow morning's view agree. Same demo seam as getWeatherOutfit:
   a live weather API replaces this table without changing the contract. */
const TOMORROW_WEATHER = [
  { temp: 27, condition: "Warm & sunny", engine: "Warm", advice: "Warm tomorrow — breathable fabrics, no heavy layer needed." },
  { temp: 24, condition: "Mild, light breeze", engine: "Cool", advice: "Mild tomorrow with a breeze — a light layer over your base will carry the day." },
  { temp: 31, condition: "Hot afternoon", engine: "Hot", advice: "Hot tomorrow — lightest fabrics you own, and keep the dark heavy pieces in the closet." },
  { temp: 23, condition: "Cloudy, chance of rain", engine: "Rainy", advice: "Rain is possible tomorrow — skip suede and light canvas shoes, and take a layer that dries fast." },
  { temp: 26, condition: "Clear & pleasant", engine: "Warm", advice: "Clear and pleasant tomorrow — almost anything in your wardrobe works; pick for the occasion." },
] as const;

function tomorrowWeather() {
  const t = new Date(now() + DAY);
  const dayNum = Math.floor(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) / DAY);
  return TOMORROW_WEATHER[Math.abs(dayNum) % TOMORROW_WEATHER.length]!;
}
function tomorrowDateStr(): string {
  return new Date(now() + DAY).toISOString().slice(0, 10);
}

/* Colour Season profiling: each wardrobe colour carries an undertone
   (warm / cool / neutral) and a depth (light / deep). The season is the
   weighted centre of the colours the user actually owns and wears —
   never a generic quiz result. */
type ColorProfile = { undertone: "warm" | "cool" | "neutral"; depth: "light" | "deep"; seasons: string[] };
const COLOR_PROFILE: Record<string, ColorProfile> = {
  black: { undertone: "cool", depth: "deep", seasons: ["Winter"] },
  white: { undertone: "cool", depth: "light", seasons: ["Winter", "Summer"] },
  navy: { undertone: "cool", depth: "deep", seasons: ["Winter", "Summer"] },
  blue: { undertone: "cool", depth: "light", seasons: ["Summer", "Winter"] },
  cream: { undertone: "warm", depth: "light", seasons: ["Spring", "Autumn"] },
  beige: { undertone: "warm", depth: "light", seasons: ["Spring", "Autumn"] },
  olive: { undertone: "warm", depth: "deep", seasons: ["Autumn"] },
  grey: { undertone: "cool", depth: "light", seasons: ["Summer"] },
  gray: { undertone: "cool", depth: "light", seasons: ["Summer"] },
  charcoal: { undertone: "cool", depth: "deep", seasons: ["Winter", "Summer"] },
  brown: { undertone: "warm", depth: "deep", seasons: ["Autumn"] },
  green: { undertone: "warm", depth: "deep", seasons: ["Autumn", "Spring"] },
  red: { undertone: "cool", depth: "deep", seasons: ["Winter", "Autumn"] },
  yellow: { undertone: "warm", depth: "light", seasons: ["Spring"] },
  teal: { undertone: "cool", depth: "deep", seasons: ["Winter", "Autumn"] },
};
const SEASON_SIGNATURES: Record<string, Array<{ name: string; hex: string }>> = {
  Spring: [{ name: "Coral", hex: "#e2725b" }, { name: "Camel", hex: "#c19a6b" }, { name: "Turquoise", hex: "#3aa6a0" }, { name: "Peach", hex: "#f2c4a0" }],
  Summer: [{ name: "Powder Blue", hex: "#a8c3e0" }, { name: "Lavender", hex: "#b7a6d9" }, { name: "Rose Pink", hex: "#d9a7b0" }, { name: "Soft White", hex: "#eef0ea" }],
  Autumn: [{ name: "Rust", hex: "#b1542e" }, { name: "Mustard", hex: "#d9a441" }, { name: "Forest Green", hex: "#3d5a3a" }, { name: "Camel", hex: "#c19a6b" }],
  Winter: [{ name: "Emerald", hex: "#1f7a5c" }, { name: "Royal Blue", hex: "#2b4f9e" }, { name: "Burgundy", hex: "#722f37" }, { name: "Icy Grey", hex: "#cfd4d8" }],
};
const SEASON_AVOID: Record<string, Array<{ name: string; hex: string; reason: string }>> = {
  Spring: [
    { name: "Charcoal", hex: "#3a3a40", reason: "Heavy blue-grey depth dulls a warm, light palette — swap it for camel or warm brown." },
    { name: "Icy Blue", hex: "#b9d2e8", reason: "Blue-based icy tones fight warm undertones and wash the face out." },
  ],
  Summer: [
    { name: "Mustard", hex: "#d9a441", reason: "Yellow-heavy warmth clashes with a cool, soft palette — it tends to look separate from everything else you wear." },
    { name: "Orange Rust", hex: "#c05a2e", reason: "Fiery warm tones overpower cool, muted colouring." },
  ],
  Autumn: [
    { name: "Icy Pink", hex: "#e8c8d8", reason: "Blue-based icy pastels sit cold against warm, deep colouring." },
    { name: "Bright White", hex: "#ffffff", reason: "Stark blue-white is harsh on a warm palette — cream and ecru do the same job softly." },
  ],
  Winter: [
    { name: "Beige", hex: "#cbb894", reason: "Muted, dusty warmth blurs a high-contrast palette — your looks sharpen with clear, saturated colour instead." },
    { name: "Olive", hex: "#5c6644", reason: "Earthy muted tones drain the contrast a Winter palette depends on." },
  ],
};

/* Resale estimate for Dead Stock: a transparent heuristic, labelled as
   an estimate in the UI — base recovery % by slot, discounted by wear.
   It is a planning number, not a marketplace quote. */
function resaleEstimate(item: ItemOut): { resale: number; pct: number } {
  const base: Record<string, number> = { outerwear: 42, shoes: 32, ethnic: 38, bottom: 36, top: 30, accessory: 25 };
  let pct = base[item.slot] ?? 30;
  pct -= Math.min(14, item.wornCount * 0.6);
  if ((item.daysSinceWorn ?? 0) > 180) pct -= 4;
  pct = Math.max(10, Math.min(50, Math.round(pct)));
  return { resale: Math.max(0, Math.round((item.price * pct) / 100 / 10) * 10), pct };
}

/* ------------------------------------------------------------------ */
/* Product catalog (Smart Shop) — structured for a future product API  */
/* ------------------------------------------------------------------ */

/* Real Smart Shop catalog — real products from real brands, sourced from
   the live Meta Catalog for India (INR) on 13 Nov 2026. Prices are the
   listed sale prices at fetch time; `mrp` is the same listing's list
   price where the catalog showed one (null = sold at MRP / no list
   price shown, so no discount is claimed). productUrl is the retailer's own
   product page (fbclid tracking stripped). "View Product" in the UI
   opens that page, where the live price and photos live. */
type RealProduct = {
  id: string; brand: string; retailer: string; productUrl: string;
  name: string; price: number; mrp: number | null; color: string; colorHex: string;
  category: string; slot: string; style: string; imageKey: string | null; note: string;
};
const REAL_CATALOG: RealProduct[] = [
  { id: "r1", brand: "Louis Philippe", retailer: "Louis Philippe", productUrl: "https://louisphilippe.abfrl.in/p/men-black-slim-fit-solid-formal-blazer-336501.html", name: "Slim Fit Formal Blazer — Black", price: 6561, mrp: null, color: "Black", colorHex: "#1c1c20", category: "Blazer", slot: "outerwear", style: "Classic", imageKey: null, note: "Interview-grade upgrade on your Peter England blazer — sharper lapel, richer fabric." },
  { id: "r2", brand: "Blackberrys", retailer: "Blackberrys", productUrl: "https://blackberrys.com/collections/men-blazers/products/formal_beige_textured_blazer_venue", name: "Venue Textured Blazer — Beige", price: 7369, mrp: null, color: "Beige", colorHex: "#cbb894", category: "Blazer", slot: "outerwear", style: "Classic", imageKey: null, note: "A light blazer colour you don't own — opens wedding and festive looks." },
  { id: "r3", brand: "Tommy Hilfiger", retailer: "Nykaa Man", productUrl: "https://www.nykaaman.com/tommy-hilfiger-solid-white-leather-sneakers/p/23811408?ptype=product&skuId=23811027", name: "Solid Leather Sneakers — White", price: 7199, mrp: 9599, color: "White", colorHex: "#f2f0eb", category: "Sneakers", slot: "shoes", style: "Minimal", imageKey: null, note: "Premium leather take on your most-worn category — your Pepe Jeans pair's formal cousin." },
  { id: "r4", brand: "Nike", retailer: "Nike India", productUrl: "https://www.nike.in/nike-ava-x-mesh-men-s-shoes/p/27764015", name: "Ava X Mesh Shoes — Black", price: 8636, mrp: 10795, color: "Black", colorHex: "#232326", category: "Shoes", slot: "shoes", style: "Sporty", imageKey: null, note: "A street-ready Nike silhouette, distinct from your Revolution 8 runners." },
  { id: "r5", brand: "H&M", retailer: "Myntra", productUrl: "http://www.myntra.com/Shirts/H%26M/HM-Regular-Fit-Textured-Knit-Shirt/45836696/buy", name: "Regular Fit Textured-Knit Shirt — Grey", price: 2799, mrp: null, color: "Grey", colorHex: "#8a8a8f", category: "Shirt", slot: "top", style: "Smart Casual", imageKey: null, note: "Texture you don't own yet — layers under both your blazers." },
  { id: "r6", brand: "Vastrado", retailer: "Myntra", productUrl: "http://www.myntra.com/Shirts/VASTRADO/VASTRADO-Men-Classic-Fit-Textured-Spread-Collar-Cotton-Casual-Shirt/37229054/buy", name: "Textured Cotton Casual Shirt — Olive", price: 759, mrp: null, color: "Olive", colorHex: "#5c6644", category: "Shirt", slot: "top", style: "Casual", imageKey: null, note: "Budget-friendly olive rotation piece — but note you already own an Allen Solly olive shirt." },
  { id: "r7", brand: "SOURAGYA", retailer: "Myntra", productUrl: "http://www.myntra.com/Kurtas/SOURAGYA/SOURAGYA-Men-Ethnic-Motifs-Printed-Kurta/42655043/buy", name: "Ethnic Motifs Printed Kurta — Grey", price: 738, mrp: 3999, color: "Grey", colorHex: "#9a9aa0", category: "Kurta", slot: "ethnic", style: "Traditional", imageKey: null, note: "A printed festive option at a steal — your kurtas are all solid colours." },
  { id: "r8", brand: "Manyavar", retailer: "Manyavar", productUrl: "https://www.manyavar.com/en-in/full-length-kurta-pajama/sunset-mustard-elegance-kurta-pajama/M415351.html", name: "Sunset Mustard Kurta Pajama Set", price: 3999, mrp: null, color: "Yellow", colorHex: "#d9a441", category: "Kurta Set", slot: "ethnic", style: "Traditional", imageKey: null, note: "Haldi-ready mustard — a festive colour completely missing from your wardrobe." },
  { id: "r9", brand: "Numero Uno", retailer: "Numero Uno", productUrl: "https://www.numerounojeanswear.com/products/mens-solid-blue-regular-fit-denim-jacket-nmjkfz1319-dark-blue", name: "Regular Fit Denim Jacket — Dark Blue", price: 2999, mrp: 4999, color: "Blue", colorHex: "#33506e", category: "Jacket", slot: "outerwear", style: "Casual", imageKey: null, note: "A second denim jacket in a darker wash than your Mast & Harbour — check the verdict first." },
  { id: "r10", brand: "Peter England", retailer: "Peter England", productUrl: "https://peterengland.abfrl.in/p/men-brown-solid-genericfit-formal-trousers-40089358.html", name: "Formal Trousers — Charcoal", price: 1245, mrp: null, color: "Charcoal", colorHex: "#3a3a40", category: "Trousers", slot: "bottom", style: "Classic", imageKey: null, note: "Sharpens your interview rotation alongside the Van Heusen pair — great value." },
  { id: "r11", brand: "Woodland", retailer: "Woodland", productUrl: "https://www.woodlandworldwide.com/product-detail/FGC0Z7041592A-WHITE", name: "Sneakers — White", price: 1836, mrp: 2295, color: "White", colorHex: "#f2f0eb", category: "Sneakers", slot: "shoes", style: "Casual", imageKey: null, note: "Memory-foam white sneakers — a rugged backup to your Pepe Jeans pair." },
  { id: "r12", brand: "Adidas", retailer: "Decathlon India", productUrl: "https://www.decathlon.in/p/1000005678/adidas-ultrarun-5-men-running-shoes-white", name: "Ultrarun 5 Running Shoes — White", price: 6019, mrp: null, color: "White", colorHex: "#f2f0eb", category: "Running Shoes", slot: "shoes", style: "Sporty", imageKey: null, note: "A white runner — your Nike and Adidas runners are both black." },
  { id: "r13", brand: "Levi's", retailer: "Nykaa Man", productUrl: "https://www.nykaaman.com/levi-s-mens-511-dark-blue-slim-fit-mid-rise-selvedge-jeans/p/24041366?ptype=product&skuId=24040809", name: "511 Selvedge Jeans — Dark Blue", price: 5599, mrp: null, color: "Blue", colorHex: "#2c4460", category: "Jeans", slot: "bottom", style: "Casual", imageKey: null, note: "Selvedge upgrade on your 511s — the connoisseur version of jeans you already love." },
  { id: "r14", brand: "House of Kari", retailer: "House of Kari", productUrl: "https://houseofkari.in/products/cotton-arri-work-kurta-for-men-brown-hk-km8brown?variant=44717058982064&utm_medium=feed&utm_campaign=meta_catalog&utm_content=product_card", name: "Cotton Aari Work Kurta — Brown", price: 2299, mrp: null, color: "Brown", colorHex: "#6d4a2f", category: "Kurta", slot: "ethnic", style: "Traditional", imageKey: null, note: "Hand-embroidered Kashmiri aari work — craft detail none of your kurtas have." },
  { id: "r15", brand: "Allen Solly", retailer: "Allen Solly", productUrl: "https://allensolly.abfrl.in/p/men-brown-genericfit-check-formal-blazer-40087308.html", name: "Check Tweed Formal Blazer — Brown", price: 9789, mrp: 10999, color: "Brown", colorHex: "#6d4a2f", category: "Blazer", slot: "outerwear", style: "Classic", imageKey: null, note: "A statement tweed — premium price, so WearWise weighs it against your 3 existing blazers." },
  { id: "r16", brand: "Spykar", retailer: "Ajio", productUrl: "https://www.ajio.com/spykar-men-typographic-print-slim-fit-hoodie/p/442192436_brown?&linkcohort=premium", name: "Typographic Print Hoodie — Brown", price: 3299, mrp: null, color: "Brown", colorHex: "#7a5c3e", category: "Hoodie", slot: "top", style: "Casual", imageKey: null, note: "You own no hoodie at all — this fills a real winter gap." },
  { id: "r17", brand: "Diwas by Manyavar", retailer: "Ajio", productUrl: "https://ajio.com/diwas-by-manyavar-men-patterned-regular-fit-kurta/p/469773125_white", name: "Patterned Regular Fit Kurta — White", price: 1499, mrp: null, color: "White", colorHex: "#f4f1ea", category: "Kurta", slot: "ethnic", style: "Traditional", imageKey: null, note: "A white festive staple — the most versatile kurta colour, and you don't own one." },
  { id: "r18", brand: "Nobero", retailer: "Nykaa Man", productUrl: "https://www.nykaaman.com/nobero-red-men-original-v1-oversized-t-shirt/p/27405540?ptype=product&skuId=27405518", name: "Original V1 Oversized T-Shirt — Red", price: 999, mrp: 2899, color: "Red", colorHex: "#a33327", category: "T-Shirt", slot: "top", style: "Streetwear", imageKey: "blacktee", note: "A bold colour pop for your oversized-tee rotation — you own blue and black, not red." },
];

/* Brand directory — the major clothing brands that exist and sell in
   India, grouped the way shoppers actually think about them. Brands
   with products in WearWise today carry a live productCount; the rest
   are listed so the directory is honest about the full landscape. */
const BRAND_DIRECTORY: Array<{ name: string; group: string; origin: string; knownFor: string }> = [
  { name: "Nike", group: "Sportswear", origin: "USA", knownFor: "Sneakers & athletic wear" },
  { name: "Adidas", group: "Sportswear", origin: "Germany", knownFor: "Sneakers, running & Originals" },
  { name: "PUMA", group: "Sportswear", origin: "Germany", knownFor: "Sneakers & sporty tees" },
  { name: "Reebok", group: "Sportswear", origin: "USA", knownFor: "Court & training shoes" },
  { name: "Asics", group: "Sportswear", origin: "Japan", knownFor: "Running shoes" },
  { name: "New Balance", group: "Sportswear", origin: "USA", knownFor: "Lifestyle sneakers" },
  { name: "Skechers", group: "Sportswear", origin: "USA", knownFor: "Comfort walking shoes" },
  { name: "Fila", group: "Sportswear", origin: "Italy", knownFor: "Retro sportswear" },
  { name: "HRX by Hrithik Roshan", group: "Sportswear", origin: "India", knownFor: "Gym & active wear" },
  { name: "Zara", group: "Global Fashion", origin: "Spain", knownFor: "Fast-fashion trends" },
  { name: "H&M", group: "Global Fashion", origin: "Sweden", knownFor: "Everyday fashion value" },
  { name: "Uniqlo", group: "Global Fashion", origin: "Japan", knownFor: "Basics & Heattech" },
  { name: "Mango", group: "Global Fashion", origin: "Spain", knownFor: "Mediterranean tailoring" },
  { name: "Marks & Spencer", group: "Global Fashion", origin: "UK", knownFor: "Quality basics & formalwear" },
  { name: "Tommy Hilfiger", group: "Global Fashion", origin: "USA", knownFor: "Preppy shirts & polos" },
  { name: "Calvin Klein", group: "Global Fashion", origin: "USA", knownFor: "Minimal premium basics" },
  { name: "GAP", group: "Global Fashion", origin: "USA", knownFor: "Denim & casual staples" },
  { name: "American Eagle", group: "Global Fashion", origin: "USA", knownFor: "Jeans & casual wear" },
  { name: "GUESS", group: "Global Fashion", origin: "USA", knownFor: "Statement denim & sneakers" },
  { name: "U.S. Polo Assn.", group: "Global Fashion", origin: "USA", knownFor: "Polo shirts & Oxfords" },
  { name: "Pepe Jeans", group: "Denim & Casual", origin: "UK", knownFor: "Denim & sneakers" },
  { name: "Levi's", group: "Denim & Casual", origin: "USA", knownFor: "501 & 511 jeans" },
  { name: "Jack & Jones", group: "Denim & Casual", origin: "Denmark", knownFor: "Jeans & menswear value" },
  { name: "Wrangler", group: "Denim & Casual", origin: "USA", knownFor: "Rugged denim" },
  { name: "Lee", group: "Denim & Casual", origin: "USA", knownFor: "Classic jeans" },
  { name: "Spykar", group: "Denim & Casual", origin: "India", knownFor: "Youth denim" },
  { name: "Roadster", group: "Denim & Casual", origin: "India", knownFor: "Myntra casual essentials" },
  { name: "The Indian Garage Co", group: "Denim & Casual", origin: "India", knownFor: "Checked shirts & streetwear" },
  { name: "Allen Solly", group: "Formal & Workwear", origin: "India", knownFor: "Friday dressing & formal shirts" },
  { name: "Van Heusen", group: "Formal & Workwear", origin: "India", knownFor: "Formal shirts & trousers" },
  { name: "Louis Philippe", group: "Formal & Workwear", origin: "India", knownFor: "Premium formalwear" },
  { name: "Peter England", group: "Formal & Workwear", origin: "India", knownFor: "Formal value" },
  { name: "Arrow", group: "Formal & Workwear", origin: "USA", knownFor: "Formal shirts" },
  { name: "Blackberrys", group: "Formal & Workwear", origin: "India", knownFor: "Blazers & occasion wear" },
  { name: "Raymond", group: "Formal & Workwear", origin: "India", knownFor: "Suiting fabrics & suits" },
  { name: "Park Avenue", group: "Formal & Workwear", origin: "India", knownFor: "Office wear" },
  { name: "MR.BUTTON", group: "Formal & Workwear", origin: "India", knownFor: "Occasion blazers" },
  { name: "Manyavar", group: "Ethnic & Festive", origin: "India", knownFor: "Kurtas, sherwanis & wedding wear" },
  { name: "FabIndia", group: "Ethnic & Festive", origin: "India", knownFor: "Handloom kurtas & craft textiles" },
  { name: "Tasva", group: "Ethnic & Festive", origin: "India", knownFor: "Designer festive menswear" },
  { name: "Diwas by Manyavar", group: "Ethnic & Festive", origin: "India", knownFor: "Everyday festive kurtas" },
  { name: "SOURAGYA", group: "Ethnic & Festive", origin: "India", knownFor: "Value printed kurtas" },
  { name: "House of Kari", group: "Ethnic & Festive", origin: "India", knownFor: "Hand-embroidered kurtas" },
  { name: "Pantaloons", group: "Ethnic & Festive", origin: "India", knownFor: "Family fashion & Indus Route ethnic" },
  { name: "Biba", group: "Ethnic & Festive", origin: "India", knownFor: "Women's ethnic wear" },
  { name: "W for Woman", group: "Ethnic & Festive", origin: "India", knownFor: "Women's kurtas & festive sets" },
  { name: "Soch", group: "Ethnic & Festive", origin: "India", knownFor: "Sarees & ethnic sets" },
  { name: "Woodland", group: "Footwear", origin: "India", knownFor: "Rugged shoes & sneakers" },
  { name: "Bata", group: "Footwear", origin: "Czech / India", knownFor: "Everyday footwear" },
  { name: "Red Tape", group: "Footwear", origin: "India", knownFor: "Sneakers & casual shoes" },
  { name: "Campus", group: "Footwear", origin: "India", knownFor: "Value sports shoes" },
  { name: "Mast & Harbour", group: "Online-First & Value", origin: "India", knownFor: "Myntra denim jackets & casuals" },
  { name: "DaMENSCH", group: "Online-First & Value", origin: "India", knownFor: "Premium tees & innerwear" },
  { name: "Nobero", group: "Online-First & Value", origin: "India", knownFor: "Oversized tees" },
  { name: "Bewakoof", group: "Online-First & Value", origin: "India", knownFor: "Graphic tees & pop culture" },
  { name: "The Souled Store", group: "Online-First & Value", origin: "India", knownFor: "Fandom merchandise" },
  { name: "Snitch", group: "Online-First & Value", origin: "India", knownFor: "Fast men's fashion drops" },
  { name: "Vastrado", group: "Online-First & Value", origin: "India", knownFor: "Value casual shirts" },
  { name: "Numero Uno", group: "Online-First & Value", origin: "India", knownFor: "Denim jackets & jeans" },
  { name: "Being Human", group: "Online-First & Value", origin: "India", knownFor: "Chinos & casual basics" },
];


/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* WearWise Intelligence Layer (server engines)                        */
/*                                                                     */
/* The durable half of the intelligence layer: these pure helpers run  */
/* over the user's real rows (wardrobe + feedback + saved outfits +    */
/* analyses) and power getIntelligence / getWardrobeROI /              */
/* recordDetailedFeedback. The client mirrors live in                  */
/* client/src/intelligence/. One set of formulas, two runtimes — the   */
/* numbers a user sees never depend on which side computed them.       */
/* ------------------------------------------------------------------ */

/** Advanced feedback (§12) stores its reason inside the feedback
    detail as "… · Reason: Too formal" so the existing table carries
    it with no migration, and the Preference Engine can read it back. */
function feedbackReasonOf(detail: string): string {
  const m = detail.match(/· Reason: (.+)$/);
  return m?.[1]?.trim() ?? "";
}

type FbRow = { kind: string; detail: string; createdAt: Date };

/** Preference Engine (§5): converts stored signals into 0–1 weights.
    Loved/liked outfits reinforce their style (parsed from the outfit
    title) and — via the reason — their colours; "not my style" and
    colour/combination reasons build the avoided maps. Wardrobe wear
    history seeds the colour/fit shares so a brand-new user still has
    an honest, data-based profile. */
function computePreferenceWeights(items: ItemOut[], fb: FbRow[]) {
  const prefColors = new Map<string, number>();
  const avoidColors = new Map<string, number>();
  const prefStyles = new Map<string, number>();
  const avoidStyles = new Map<string, number>();
  const prefFits = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, by: number) => { if (k) m.set(k, (m.get(k) ?? 0) + by); };
  for (const i of items) {
    const w = i.wornCount + (i.favorite ? 6 : 0);
    if (w > 0) { bump(prefColors, i.color, w); bump(prefStyles, i.style, w); bump(prefFits, i.fit, w); }
  }
  for (const f of fb) {
    const style = styleFromFeedbackDetail(f.detail);
    const reason = feedbackReasonOf(f.detail);
    if (f.kind === "love" || f.kind === "liked" || f.kind === "good") {
      bump(prefStyles, style, 14);
      if (reason === "Perfect") bump(prefStyles, style, 8);
    }
    if (f.kind === "not") {
      bump(avoidStyles, style, 14);
      if (reason === "Don't like the color") {
        // The disliked look's lead colour: most-worn top colour is the
        // best available proxy in the stored title-only detail.
        const topColor = items.filter((i) => i.slot === "top").sort((a, b) => b.wornCount - a.wornCount)[0]?.color ?? "";
        bump(avoidColors, topColor, 6);
      }
      if (reason === "Too formal" || reason === "Not suitable for me") bump(avoidStyles, style, 6);
    }
  }
  const norm = (m: Map<string, number>) => {
    const max = Math.max(1, ...m.values());
    const out: Record<string, number> = {};
    for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) out[k] = Math.round((v / max) * 100) / 100;
    return out;
  };
  return {
    preferredColors: norm(prefColors),
    avoidedColors: norm(avoidColors),
    preferredStyles: norm(prefStyles),
    avoidedStyles: norm(avoidStyles),
    preferredFits: norm(prefFits),
    signalCount: fb.length,
  };
}

/** Confidence Engine (§9): data depth, not decoration. */
function confidenceFor(itemCount: number, feedbackCount: number, subjectKnown = true): number {
  const depth = Math.min(30, itemCount * 1.5);
  const fbDepth = Math.min(25, feedbackCount * 2.5);
  const completeness = itemCount ? 25 * 0.85 : 0;
  return Math.max(5, Math.min(98, Math.round(depth + fbDepth + completeness + (subjectKnown ? 20 : 8))));
}

/** Wardrobe ROI (§13) for one owned piece, against the whole wardrobe. */
function roiForItem(item: ItemOut, items: ItemOut[]) {
  const partners = items.filter((i) => i.id !== item.id);
  const compatible = partners.filter((i) => i.slot !== item.slot && (NEUTRALS.has(i.color.toLowerCase()) || NEUTRALS.has(item.color.toLowerCase()) || i.color === item.color)).length;
  const occasions = new Set<string>();
  for (const o of item.occasions) occasions.add(o);
  const dupes = partners.filter((i) => i.slot === item.slot && i.color.toLowerCase() === item.color.toLowerCase()).length;
  const duplicateRisk = Math.min(95, dupes * 32);
  const versatility = Math.max(15, Math.min(97, Math.round(30 + compatible * 3 + occasions.size * 5)));
  const wearFactor = Math.min(30, item.wornCount * 1.2);
  const roiScore = Math.max(8, Math.min(98, Math.round(versatility * 0.45 + wearFactor + (100 - duplicateRisk) * 0.18 + (item.favorite ? 5 : 0))));
  const gapContribution = dupes >= 2
    ? "Low — this colour + slot is already well covered; its value is rotation, not new combinations."
    : compatible >= 10
      ? `High — pairs across ${compatible} pieces, so it multiplies outfits rather than adding one.`
      : "Moderate — useful pairings, but a narrower set of partners than your most versatile pieces.";
  return {
    itemId: item.id, name: item.name, brand: item.brand,
    roiScore, potentialOutfits: item.outfitCount, compatibleItems: compatible,
    compatibleOccasions: occasions.size, versatility,
    wearFrequency: item.wornCount, duplicateRisk,
    price: item.price, costPerWear: item.costPerWear, gapContribution,
  };
}

const profileSchema = z.object({ id: z.number(), name: z.string(), email: z.string() });

/* ------------------------------------------------------------------ */
/* Production auth — passwords + server-side sessions                  */
/*                                                                     */
/* Passwords are hashed with PBKDF2-HMAC-SHA256 (WebCrypto — action    */
/* code is runtime-neutral, so no Node/Bun host modules) at 210,000    */
/* iterations with a random 128-bit salt, stored in the                */
/* self-describing form "pbkdf2$iterations$saltB64$hashB64"; the       */
/* plaintext never touches the database. Sign-in issues a random       */
/* 256-bit session token; only its SHA-256 hash is stored, so a DB     */
/* leak does not leak usable tokens. Sessions live 30 days. Every      */
/* user-scoped action calls requireAuth: the session must be live AND  */
/* its user must equal the userId in the request — a bare userId is    */
/* a claim, not a credential, and is never trusted on its own.         */
/* ------------------------------------------------------------------ */

const SESSION_TTL_MS = 30 * 86_400_000;
const PBKDF2_ITERATIONS = 210_000;

/* Login rate limiting (issue 10): 5 failed sign-ins within 15 minutes
   locks that email for 15 minutes. The failure messages are shared by
   every credential failure so a response never reveals whether the
   account exists, whether the password was merely wrong, or (until
   the lock engages) how close the email is to locking. */
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_LOCK_MS = 15 * 60_000;
const LOGIN_FAILED_MESSAGE = "Incorrect email or password — try again.";
const LOGIN_LOCKED_MESSAGE = "Too many sign-in attempts — try again in a few minutes.";
const textEncoder = new TextEncoder();

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function derivePasswordBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256,
  );
  return new Uint8Array(bits);
}

async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await derivePasswordBits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false;
  let expected: Uint8Array;
  try {
    expected = b64ToBytes(parts[3]!);
  } catch { return false; }
  if (expected.length === 0) return false;
  const actual = await derivePasswordBits(password, b64ToBytes(parts[2]!), iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

type Db = SpaceDb<typeof schema>;

async function issueSession(db: Db, userId: number): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  const expires = new Date(now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({
    userId, tokenHash: await sha256Hex(token), expiresAt: expires, lastSeenAt: new Date(),
  });
  return { token, expiresAt: expires.toISOString() };
}

/* The gate every user-scoped action passes through. Returns the
   session's user id (which is also the only user id the handler may
   act on — it equals args.userId or this throws). */
async function requireAuth(ctx: Ctx, args: { sessionToken?: string; userId: number }): Promise<number> {
  if (!args.sessionToken) throw new Error("Your session has expired — please log in again.");
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.sessions)
    .where(eq(schema.sessions.tokenHash, await sha256Hex(args.sessionToken))).limit(1);
  const session = rows[0];
  if (!session) throw new Error("Your session has expired — please log in again.");
  if (session.expiresAt.getTime() <= now()) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, session.id));
    throw new Error("Your session has expired — please log in again.");
  }
  if (session.userId !== args.userId) {
    throw new Error("This session doesn't match the requested account.");
  }
  await db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, session.id));
  return session.userId;
}

/* listBrands personalises counts when a userId is supplied; there the
   token is optional, but when one is supplied it must be valid and
   match — a bad token never silently degrades to "trusted". */
async function optionalAuth(ctx: Ctx, args: { sessionToken?: string; userId?: number }): Promise<number | null> {
  if (!args.sessionToken) return null;
  if (!args.userId) throw new Error("This session doesn't match the requested account.");
  return requireAuth(ctx, { sessionToken: args.sessionToken, userId: args.userId });
}

/* Records one failed sign-in for an email (issue 10). Failures older
   than the 15-minute window stop counting, so the counter is "5
   failures inside 15 minutes", not a lifetime total; reaching the
   limit sets the lock. Called for unknown emails, wrong passwords
   and failed first-login claims alike — the attempts table is keyed
   by email precisely so addresses with no account throttle too.
   One atomic upsert rather than read-then-write, so simultaneous
   failed attempts can't undercount by racing each other. */
async function recordLoginFailure(db: Db, email: string): Promise<void> {
  const t = now();
  const newCount = sql`case when ${t} - login_attempts.last_attempt_at < ${LOGIN_WINDOW_MS} then login_attempts.failed_count + 1 else 1 end`;
  await db.run(sql`
    insert into login_attempts (email, failed_count, last_attempt_at, locked_until)
    values (${email}, 1, ${t}, null)
    on conflict(email) do update set
      failed_count = ${newCount},
      locked_until = case when (${newCount}) >= ${LOGIN_MAX_FAILURES} then ${t + LOGIN_LOCK_MS} else null end,
      last_attempt_at = ${t}
  `);
}

/* sessionToken is optional in the schema only because the client
   attaches it automatically at the transport layer (see api.ts);
   requireAuth rejects any call where it is missing or invalid, so
   omitting it never grants access. */
const authFields = {
  sessionToken: z.string().min(1).max(200).optional(),
  userId: z.number().int().positive(),
};

/* First-login seeding for a brand-new account: the real branded
   wardrobe plus the demo wear history Repeat Radar reads. Shared by
   register and demoLogin so both create identical starting state. */
async function seedNewAccount(db: Db, profileId: number): Promise<void> {
  const t = now();
  await db.insert(schema.wardrobeItems).values(
    REAL_WARDROBE.map((d, idx) => ({
      userId: profileId,
      brand: d.brand, productUrl: d.productUrl, retailer: d.retailer,
      name: d.name, category: d.category, slot: d.slot, color: d.color,
      colorHex: d.colorHex, pattern: d.pattern, material: d.material,
      style: d.style, season: d.season, formality: d.formality, price: d.price, mrp: d.mrp,
      wornCount: d.wornCount,
      lastWornAt: d.daysAgo === null ? null : new Date(t - d.daysAgo * DAY),
      favorite: d.favorite, imageKey: d.imageKey,
      createdAt: new Date(t - idx * 1000),
    })),
  );
  /* Demo wear history for Repeat Radar — recent wears WITH their
     social context, layered on the seeded wardrobe the same way its
     wear counts are. Indices follow REAL_WARDROBE order; rows come
     back in that same order (createdAt desc = seed order). The
     user's own logged wears replace this picture as they use the app. */
  const seededRows = await db.select().from(schema.wardrobeItems)
    .where(eq(schema.wardrobeItems.userId, profileId))
    .orderBy(desc(schema.wardrobeItems.createdAt));
  const seedId = (idx: number) => seededRows[idx]?.id;
  const demoLogs: Array<{ idx: number[]; occasion: string; audience: string; location: string; daysAgo: number }> = [
    { idx: [2, 9, 12], occasion: "College", audience: "College friends", location: "Campus", daysAgo: 3 },
    { idx: [1, 22, 11], occasion: "Placement Interview", audience: "Placement panel", location: "Placement cell", daysAgo: 5 },
    { idx: [19, 10, 14], occasion: "Casual", audience: "Close friends", location: "Neighbourhood café", daysAgo: 9 },
    { idx: [0, 9, 12], occasion: "Date", audience: "Dinner group", location: "Dinner out", daysAgo: 12 },
    { idx: [16, 11], occasion: "Festive", audience: "Family", location: "Family function", daysAgo: 20 },
  ];
  const logRows = demoLogs
    .map((l) => ({ ...l, ids: l.idx.map(seedId).filter((n): n is number => typeof n === "number") }))
    .filter((l) => l.ids.length >= 2);
  if (logRows.length) {
    await db.insert(schema.wearLogs).values(logRows.map((l) => ({
      userId: profileId,
      itemIds: JSON.stringify(l.ids),
      occasion: l.occasion, audience: l.audience, location: l.location,
      wornAt: new Date(t - l.daysAgo * DAY),
    })));
  }
}

async function needsRealUpgradeFor(db: Db, profileId: number): Promise<boolean> {
  const rows = await db.select({ brand: schema.wardrobeItems.brand })
    .from(schema.wardrobeItems)
    .where(eq(schema.wardrobeItems.userId, profileId));
  return rows.length === 0 || rows.every((r) => !r.brand);
}

/* The one shared demo account. It predates the auth_provider column
   (migration 0008 defaults existing rows to "password"), so it is
   recognised by email as well as by provider — password login must
   never claim it, and demoLogin re-normalises its row on every use. */
const DEMO_EMAIL = "satyajeet@demo.wearwise";

const authResponse = z.object({
  profile: profileSchema,
  sessionToken: z.string(),
  sessionExpiresAt: z.string(),
  seeded: z.boolean(),
  needsRealUpgrade: z.boolean(),
});

export const Actions = {
  register: defineAction({
    description: "Creates a WearWise account with an email + password (PBKDF2-hashed server-side), seeds the real branded wardrobe, and returns a profile plus a server session token.",
    request: z.object({
      name: z.string().min(1).max(80),
      email: z.string().email().max(120),
      password: z.string().min(8).max(200),
    }),
    response: authResponse,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const email = args.email.trim().toLowerCase();
      const existing = await db.select().from(schema.profiles)
        .where(eq(schema.profiles.email, email)).limit(1);
      if (existing[0]) {
        throw new Error("An account with that email already exists — log in instead.");
      }
      const inserted = await db.insert(schema.profiles).values({
        name: args.name.trim(), email,
        passwordHash: await hashPassword(args.password), authProvider: "password",
      }).returning();
      const profile = inserted[0];
      if (!profile) throw new Error("register: profile insert failed");
      await seedNewAccount(db, profile.id);
      const session = await issueSession(db, profile.id);
      ctx.invalidateQueries();
      return {
        profile: { id: profile.id, name: profile.name, email: profile.email },
        sessionToken: session.token, sessionExpiresAt: session.expiresAt,
        seeded: true, needsRealUpgrade: false,
      };
    },
  }),

  login: defineAction({
    description: "Signs in with email + password and returns the profile plus a fresh server session token. Accounts created before password auth existed (no stored hash) are claimed by setting the password on first password login. Rate-limited per email (issue 10): 5 failures within 15 minutes locks the email for 15 minutes, the lock is checked before the password is verified, and credential errors never reveal whether the account exists.",
    request: z.object({
      email: z.string().email().max(120),
      password: z.string().min(1).max(200),
    }),
    response: authResponse,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const email = args.email.trim().toLowerCase();
      /* Rate limit first (issue 10): a locked email is refused BEFORE
         any password verification, with the same message whether or
         not an account exists for it — the attempts table is keyed by
         email alone, so unknown addresses lock exactly like real
         ones and probing can't tell the difference. */
      const attemptRows = await db.select().from(schema.loginAttempts)
        .where(eq(schema.loginAttempts.email, email)).limit(1);
      const attempt = attemptRows[0];
      if (attempt?.lockedUntil && attempt.lockedUntil.getTime() > now()) {
        throw new Error(LOGIN_LOCKED_MESSAGE);
      }
      const rows = await db.select().from(schema.profiles)
        .where(eq(schema.profiles.email, email)).limit(1);
      const profile = rows[0];
      if (!profile) {
        /* Same message as a wrong password, and the failure still
           counts toward the lockout: sign-in errors never reveal
           whether an account exists. */
        await recordLoginFailure(db, email);
        throw new Error(LOGIN_FAILED_MESSAGE);
      }
      if (profile.authProvider === "demo" || email === DEMO_EMAIL) {
        throw new Error("That's the one-tap demo account — use “Continue with the demo account”, or create your own account with a password.");
      }
      let claimed = false;
      if (!profile.passwordHash) {
        /* Pre-auth account (created under name + email demo sign-in):
           the first password login claims it by setting the password.
           Passwords shorter than the register minimum can't claim —
           and a failed claim counts toward the lockout like any
           other failed sign-in. */
        if (args.password.length < 8) {
          await recordLoginFailure(db, email);
          throw new Error("This account predates passwords — set a password of at least 8 characters to claim it and sign in.");
        }
        await db.update(schema.profiles)
          .set({ passwordHash: await hashPassword(args.password) })
          .where(eq(schema.profiles.id, profile.id));
        claimed = true;
      } else if (!(await verifyPassword(args.password, profile.passwordHash))) {
        await recordLoginFailure(db, email);
        throw new Error(LOGIN_FAILED_MESSAGE);
      }
      /* A successful sign-in clears the email's failure counter. */
      await db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.email, email));
      const session = await issueSession(db, profile.id);
      const needsRealUpgrade = claimed ? false : await needsRealUpgradeFor(db, profile.id);
      ctx.invalidateQueries();
      return {
        profile: { id: profile.id, name: profile.name, email: profile.email },
        sessionToken: session.token, sessionExpiresAt: session.expiresAt,
        seeded: false, needsRealUpgrade,
      };
    },
  }),

  demoLogin: defineAction({
    description: "One-tap sign-in to the shared demo account (no password by design). Creates and seeds it on first use, and returns a profile plus a server session token like a normal login.",
    request: z.object({}),
    response: authResponse,
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const email = DEMO_EMAIL;
      const rows = await db.select().from(schema.profiles)
        .where(eq(schema.profiles.email, email)).limit(1);
      let profile = rows[0];
      let seeded = false;
      if (!profile) {
        const inserted = await db.insert(schema.profiles).values({
          name: "Satyajeet", email, authProvider: "demo",
        }).returning();
        profile = inserted[0];
        if (!profile) throw new Error("demoLogin: profile insert failed");
        await seedNewAccount(db, profile.id);
        seeded = true;
      } else if (profile.authProvider !== "demo" || profile.passwordHash !== null) {
        /* Self-heal: the demo row predates the auth_provider column,
           and a password login may have claimed it before this guard
           existed. The demo account is passwordless by design. */
        await db.update(schema.profiles)
          .set({ authProvider: "demo", passwordHash: null })
          .where(eq(schema.profiles.id, profile.id));
      }
      const session = await issueSession(db, profile.id);
      const needsRealUpgrade = seeded ? false : await needsRealUpgradeFor(db, profile.id);
      ctx.invalidateQueries();
      return {
        profile: { id: profile.id, name: profile.name, email: profile.email },
        sessionToken: session.token, sessionExpiresAt: session.expiresAt,
        seeded, needsRealUpgrade,
      };
    },
  }),

  logout: defineAction({
    description: "Ends the caller's server session (the stored token hash is deleted, so the token stops working immediately).",
    request: z.object({ sessionToken: z.string().min(1).max(200) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.sessions)
        .where(eq(schema.sessions.tokenHash, await sha256Hex(args.sessionToken)));
      return { ok: true };
    },
  }),

  getSession: defineAction({
    description: "Validates a stored session token and returns its profile, or a null profile when the token is unknown or expired — used to restore (or drop) a saved sign-in on app load.",
    request: z.object({ sessionToken: z.string().min(1).max(200) }),
    response: z.object({ profile: profileSchema.nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.sessions)
        .where(eq(schema.sessions.tokenHash, await sha256Hex(args.sessionToken))).limit(1);
      const session = rows[0];
      if (!session) return { profile: null };
      if (session.expiresAt.getTime() <= now()) {
        await db.delete(schema.sessions).where(eq(schema.sessions.id, session.id));
        return { profile: null };
      }
      await db.update(schema.sessions).set({ lastSeenAt: new Date() })
        .where(eq(schema.sessions.id, session.id));
      const profiles = await db.select().from(schema.profiles)
        .where(eq(schema.profiles.id, session.userId)).limit(1);
      const p = profiles[0];
      return { profile: p ? { id: p.id, name: p.name, email: p.email } : null };
    },
  }),

  seedRealWardrobe: defineAction({
    description: "Replaces the user's wardrobe with the real branded wardrobe (real products from real brands sold in India) — used by the one-tap upgrade from the old demo data.",
    request: z.object({ ...authFields }),
    response: z.object({ ok: z.literal(true), count: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; count: number }> {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      await deleteAllUserPhotoBlobs(ctx, userId);
      await db.delete(schema.savedOutfits).where(eq(schema.savedOutfits.userId, userId));
      await db.delete(schema.wardrobeItems).where(eq(schema.wardrobeItems.userId, userId));
      const t = now();
      await db.insert(schema.wardrobeItems).values(
        REAL_WARDROBE.map((d, idx) => ({
          userId: userId,
          brand: d.brand, productUrl: d.productUrl, retailer: d.retailer,
          name: d.name, category: d.category, slot: d.slot, color: d.color,
          colorHex: d.colorHex, pattern: d.pattern, material: d.material,
          style: d.style, season: d.season, formality: d.formality, price: d.price, mrp: d.mrp,
          wornCount: d.wornCount,
          lastWornAt: d.daysAgo === null ? null : new Date(t - d.daysAgo * DAY),
          photoBlobKey: null,
          favorite: d.favorite, imageKey: d.imageKey,
          createdAt: new Date(t - idx * 1000),
        })),
      );
      ctx.invalidateQueries();
      return { ok: true, count: REAL_WARDROBE.length };
    },
  }),

  getProfile: defineAction({
    description: "Returns the signed-in user's profile by id.",
    request: z.object({ ...authFields }),
    response: z.object({ profile: profileSchema.nullable() }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.profiles).where(eq(schema.profiles.id, userId)).limit(1);
      const p = rows[0];
      return { profile: p ? { id: p.id, name: p.name, email: p.email } : null };
    },
  }),

  listItems: defineAction({
    description: "Lists the user's wardrobe items with wear stats and cost-per-wear.",
    request: z.object({ ...authFields }),
    response: z.object({ items: z.array(itemSchema) }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      return { items: await loadItems(ctx, userId) };
    },
  }),

  addItem: defineAction({
    description: "Adds a clothing item to the user's wardrobe.",
    request: z.object({
      ...authFields,
      brand: z.string().max(60).default(""),
      productUrl: z.string().max(600).nullable().default(null),
      retailer: z.string().max(60).default(""),
      name: z.string().min(1).max(90),
      category: z.string().min(1).max(40),
      slot: z.string().min(1).max(20),
      color: z.string().min(1).max(30),
      colorHex: z.string().max(10).default("#888888"),
      pattern: z.string().max(30).default("Solid"),
      material: z.string().max(40).default("Cotton"),
      style: z.string().max(30).default("Casual"),
      fit: z.string().max(20).default("Regular"),
      occasions: z.array(z.string().max(30)).max(8).default([]),
      season: z.string().max(20).default("All Season"),
      formality: z.number().int().min(1).max(5).default(2),
      price: z.number().min(0).max(1_000_000).default(0),
      mrp: z.number().min(0).max(1_000_000).nullable().default(null),
      favorite: z.boolean().default(false),
      imageKey: z.string().nullable().default(null),
      /* The user's own uploaded photo (downscaled client-side), stored
         with the item so it stays in the wardrobe. Validated by magic
         bytes server-side; null = no photo uploaded (sample garment). */
      photo: photoArg.nullable().default(null),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const photoBlobKey = args.photo ? await storePhoto(ctx, userId, args.photo) : null;
      const rows = await db.insert(schema.wardrobeItems).values({
        userId: userId, brand: args.brand, productUrl: args.productUrl, retailer: args.retailer,
        name: args.name, category: args.category, slot: args.slot,
        color: args.color, colorHex: args.colorHex, pattern: args.pattern, material: args.material,
        style: args.style, fit: args.fit, occasions: JSON.stringify(args.occasions),
        season: args.season, formality: args.formality, price: args.price,
        mrp: args.mrp && args.mrp > 0 ? args.mrp : null,
        favorite: args.favorite ? 1 : 0,
        imageKey: args.imageKey,
        photoBlobKey,
      }).returning({ id: schema.wardrobeItems.id });
      const row = rows[0];
      if (!row) throw new Error("addItem failed");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  updateItem: defineAction({
    description: "Edits a wardrobe item — name, category, colour, pattern, material, style, season, price, or favorite flag — so a wrong scan can be fully corrected.",
    request: z.object({
      ...authFields,
      itemId: z.number().int().positive(),
      name: z.string().min(1).max(90).optional(),
      category: z.string().min(1).max(40).optional(),
      slot: z.string().min(1).max(20).optional(),
      color: z.string().min(1).max(30).optional(),
      colorHex: z.string().max(10).optional(),
      pattern: z.string().max(30).optional(),
      material: z.string().max(40).optional(),
      style: z.string().max(30).optional(),
      fit: z.string().max(20).optional(),
      occasions: z.array(z.string().max(30)).max(8).optional(),
      season: z.string().max(20).optional(),
      formality: z.number().int().min(1).max(5).optional(),
      price: z.number().min(0).max(1_000_000).optional(),
      mrp: z.number().min(0).max(1_000_000).nullable().optional(),
      favorite: z.boolean().optional(),
      /* Photo tri-state: omitted = keep the saved photo, null = remove
         it (blob deleted, item falls back to imageKey / colour tile),
         object = replace it (new blob stored, old blob deleted). */
      photo: photoArg.nullable().optional(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const patch: Partial<typeof schema.wardrobeItems.$inferInsert> = {};
      if (args.name !== undefined) patch.name = args.name;
      if (args.category !== undefined) patch.category = args.category;
      if (args.slot !== undefined) patch.slot = args.slot;
      if (args.color !== undefined) patch.color = args.color;
      if (args.colorHex !== undefined) patch.colorHex = args.colorHex;
      if (args.pattern !== undefined) patch.pattern = args.pattern;
      if (args.material !== undefined) patch.material = args.material;
      if (args.style !== undefined) patch.style = args.style;
      if (args.fit !== undefined) patch.fit = args.fit;
      if (args.occasions !== undefined) patch.occasions = JSON.stringify(args.occasions);
      if (args.season !== undefined) patch.season = args.season;
      if (args.formality !== undefined) patch.formality = args.formality;
      if (args.price !== undefined) patch.price = args.price;
      if (args.mrp !== undefined) patch.mrp = args.mrp && args.mrp > 0 ? args.mrp : null;
      if (args.favorite !== undefined) patch.favorite = args.favorite ? 1 : 0;
      let oldPhotoKey: string | null = null;
      if (args.photo !== undefined) {
        const existing = await db.select({ photoBlobKey: schema.wardrobeItems.photoBlobKey })
          .from(schema.wardrobeItems)
          .where(and(eq(schema.wardrobeItems.id, args.itemId), eq(schema.wardrobeItems.userId, userId)))
          .limit(1);
        oldPhotoKey = existing[0]?.photoBlobKey ?? null;
        patch.photoBlobKey = args.photo ? await storePhoto(ctx, userId, args.photo) : null;
      }
      await db.update(schema.wardrobeItems).set(patch)
        .where(and(eq(schema.wardrobeItems.id, args.itemId), eq(schema.wardrobeItems.userId, userId)));
      if (args.photo !== undefined && oldPhotoKey && oldPhotoKey !== patch.photoBlobKey) {
        await deletePhotoBlob(ctx, oldPhotoKey);
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteItem: defineAction({
    description: "Removes a wardrobe item.",
    request: z.object({ ...authFields, itemId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const existing = await db.select({ photoBlobKey: schema.wardrobeItems.photoBlobKey })
        .from(schema.wardrobeItems)
        .where(and(eq(schema.wardrobeItems.id, args.itemId), eq(schema.wardrobeItems.userId, userId)))
        .limit(1);
      await db.delete(schema.wardrobeItems)
        .where(and(eq(schema.wardrobeItems.id, args.itemId), eq(schema.wardrobeItems.userId, userId)));
      /* The item's stored photo goes with it — no orphaned blobs. */
      await deletePhotoBlob(ctx, existing[0]?.photoBlobKey);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  wearOutfit: defineAction({
    description: "Marks outfit pieces as worn today, updating wear counts, last-worn dates, and the learning loop.",
    request: z.object({ ...authFields, itemIds: z.array(z.number().int().positive()).min(1).max(8) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.wardrobeItems)
        .where(eq(schema.wardrobeItems.userId, userId));
      for (const r of rows) {
        if (args.itemIds.includes(r.id)) {
          await db.update(schema.wardrobeItems)
            .set({ wornCount: r.wornCount + 1, lastWornAt: new Date() })
            .where(eq(schema.wardrobeItems.id, r.id));
        }
      }
      await db.insert(schema.feedback).values({ userId: userId, kind: "worn", detail: `Wore ${args.itemIds.length} pieces` });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  generateOutfit: defineAction({
    description: "Generates a scored outfit from the user's wardrobe for an occasion, weather, and style (the recommendation engine).",
    request: z.object({
      ...authFields,
      occasion: z.string().min(1).max(30),
      weather: z.string().min(1).max(20),
      style: z.string().min(1).max(30),
      seed: z.number().int().min(0).default(0),
    }),
    response: z.object({ outfit: outfitSchema, confidence: z.number(), reasons: z.array(z.string()) }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      // Personalization loop (Phase 6): past outfit ratings bias the picks.
      const db = ctx.db<typeof schema>();
      const fb = await db.select().from(schema.feedback).where(eq(schema.feedback.userId, userId));
      const taste: TasteBias = {
        loved: [...new Set(fb.filter((f) => f.kind === "love" || f.kind === "liked" || f.kind === "good").map((f) => styleFromFeedbackDetail(f.detail)).filter(Boolean))],
        disliked: [...new Set(fb.filter((f) => f.kind === "not").map((f) => styleFromFeedbackDetail(f.detail)).filter(Boolean))],
      };
      const outfit = buildOutfit(items, args.occasion, args.weather, args.style, args.seed, taste);
      /* Confidence + Explanation engines (§9/§10): every outfit now
         ships with an honest confidence (data depth) and reasons built
         from its own factor scores and the user's taste profile. */
      const confidence = confidenceFor(items.length, fb.length);
      const topFactor = [...outfit.factors].sort((a, b) => b.score - a.score)[0];
      const reasons: string[] = [];
      /* Explanation honesty (audit fix): never explain an outfit that
         doesn't exist. With an empty/partial wardrobe the reasons must
         say what's missing, not claim the formality "lands right". */
      if (outfit.items.length === 0) {
        reasons.push("Your wardrobe has no pieces WearWise can style yet — add a top, a bottom and shoes to unlock full outfits");
        return { outfit, confidence, reasons };
      }
      if (topFactor && topFactor.score >= 70) reasons.push(`${topFactor.label} is strong here (${topFactor.score}/100)`);
      reasons.push(`Formality and pieces land right for ${args.occasion}`);
      if (taste.loved.includes(args.style)) reasons.push(`You rated ${args.style} looks highly before — this leans into that`);
      const leadColor = outfit.items[0]?.color;
      if (leadColor && NEUTRALS.has(leadColor.toLowerCase())) reasons.push(`Built on ${leadColor.toLowerCase()} — a proven neutral in your rotation`);
      if (outfit.items.length >= 3) reasons.push(`All ${outfit.items.length} pieces are your own — no shopping required`);
      return { outfit, confidence, reasons: reasons.slice(0, 4) };
    },
  }),

  stylistAsk: defineAction({
    description: "Answers a free-text styling question with a recommended outfit from the user's wardrobe (AI stylist chat).",
    request: z.object({
      ...authFields,
      prompt: z.string().min(1).max(300),
      seed: z.number().int().min(0).default(0),
    }),
    response: z.object({ reply: z.string(), outfit: outfitSchema }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const p = args.prompt.toLowerCase();
      let occasion = "Casual";
      if (p.includes("presentation") || p.includes("interview") || p.includes("placement")) occasion = "Placement Interview";
      else if (p.includes("date")) occasion = "Date";
      else if (p.includes("party")) occasion = "Party";
      else if (p.includes("wedding") || p.includes("shaadi")) occasion = "Wedding";
      else if (p.includes("festive") || p.includes("diwali") || p.includes("eid")) occasion = "Festive";
      else if (p.includes("travel") || p.includes("trip") || p.includes("flight")) occasion = "Travel";
      else if (p.includes("gym") || p.includes("workout")) occasion = "Gym";
      else if (p.includes("college") || p.includes("class")) occasion = "College";
      const weather = p.includes("rain") ? "Rainy" : p.includes("cold") || p.includes("winter") ? "Cold" : p.includes("hot") || p.includes("summer") ? "Hot" : "Warm";
      const style = occasion === "Placement Interview" || occasion === "Wedding" ? "Classic" : occasion === "Festive" ? "Traditional" : "Smart Casual";
      const outfit = buildOutfit(items, occasion, weather, style, args.seed);
      const names = outfit.items.slice(0, 3).map((i) => `your ${i.name.toLowerCase()}`).join(", ");
      const lead = occasion === "Placement Interview"
        ? "For a presentation, you want polish without stiffness."
        : occasion === "Date" ? "For a date, aim for effortless and put-together."
        : occasion === "Festive" || occasion === "Wedding" ? "This is a moment for your ethnic pieces to shine."
        : occasion === "Travel" ? "Comfort first, but let's keep it sharp."
        : "Here's what works best from your wardrobe.";
      const reply = outfit.items.length
        ? `${lead} Go with ${names}. It looks considered without trying too hard — and it scores ${outfit.matchScore}% against your wardrobe.`
        : "Your wardrobe needs a few core pieces before I can style this. Add some clothes and I'll build the outfit.";
      return { reply, outfit };
    },
  }),

  saveOutfit: defineAction({
    description: "Saves a generated outfit to the user's collection.",
    request: z.object({
      ...authFields,
      title: z.string().min(1).max(90),
      itemIds: z.array(z.number().int().positive()).min(1).max(8),
      occasion: z.string().max(30).default(""),
      matchScore: z.number().int().min(0).max(100),
      explanation: z.string().max(600).default(""),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const rows = await db.insert(schema.savedOutfits).values({
        userId: userId, title: args.title, itemIds: JSON.stringify(args.itemIds),
        occasion: args.occasion, matchScore: args.matchScore, explanation: args.explanation,
      }).returning({ id: schema.savedOutfits.id });
      await db.insert(schema.feedback).values({ userId: userId, kind: "saved", detail: args.title });
      const row = rows[0];
      if (!row) throw new Error("saveOutfit failed");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  listSavedOutfits: defineAction({
    description: "Lists the user's saved outfits with their items resolved.",
    request: z.object({ ...authFields }),
    response: z.object({
      outfits: z.array(z.object({
        id: z.number(), title: z.string(), occasion: z.string(), matchScore: z.number(),
        explanation: z.string(), items: z.array(itemSchema),
      })),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const items = await loadItems(ctx, userId);
      const byId = new Map(items.map((i) => [i.id, i]));
      const rows = await db.select().from(schema.savedOutfits)
        .where(eq(schema.savedOutfits.userId, userId))
        .orderBy(desc(schema.savedOutfits.id));
      return {
        outfits: rows.map((r) => {
          let ids: number[] = [];
          try { ids = JSON.parse(r.itemIds) as number[]; } catch { ids = []; }
          return {
            id: r.id, title: r.title, occasion: r.occasion, matchScore: r.matchScore,
            explanation: r.explanation,
            items: ids.map((id) => byId.get(id)).filter((i): i is ItemOut => Boolean(i)),
          };
        }),
      };
    },
  }),

  deleteSavedOutfit: defineAction({
    description: "Deletes a saved outfit.",
    request: z.object({ ...authFields, outfitId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      await db.delete(schema.savedOutfits)
        .where(and(eq(schema.savedOutfits.id, args.outfitId), eq(schema.savedOutfits.userId, userId)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  analyzeClothing: defineAction({
    description: "Starting-guess scan: suggests a garment's category, colour, pattern, material, style and season from its filename or a chosen sample. The guess is a draft the user reviews and edits before adding — no confidence score is claimed.",
    request: z.object({
      ...authFields,
      hint: z.string().max(120).default(""),
      sampleIndex: z.number().int().min(0).max(5).default(0),
    }),
    response: z.object({
      detected: z.object({
        name: z.string(), category: z.string(), slot: z.string(), color: z.string(), colorHex: z.string(),
        pattern: z.string(), material: z.string(), style: z.string(), fit: z.string(), occasions: z.array(z.string()), season: z.string(),
        formality: z.number(), suggestedPrice: z.number(), suggestedMrp: z.number().nullable(), imageKey: z.string().nullable(),
      }),
      steps: z.array(z.string()),
    }),
    async handler(ctx, args) {
      await requireAuth(ctx, args); /* gate only — the scan guess reads no user rows */
      const samples = [
        { name: "H&M Navy Oversized Shirt", category: "Shirt", slot: "top", color: "Navy", colorHex: "#24365e", pattern: "Solid", material: "Cotton Poplin", style: "Casual", fit: "Oversized", season: "All Season", formality: 2, suggestedPrice: 1699, imageKey: "hero" as string | null },
        { name: "Zara Cream Overshirt", category: "Overshirt", slot: "outerwear", color: "Cream", colorHex: "#e7dcc3", pattern: "Solid", material: "Cotton Twill", style: "Minimal", fit: "Relaxed", season: "All Season", formality: 2, suggestedPrice: 2499, imageKey: "overshirt" as string | null },
        { name: "PUMA Black Oversized Tee", category: "T-Shirt", slot: "top", color: "Black", colorHex: "#1b1b1e", pattern: "Solid", material: "Heavy Cotton", style: "Streetwear", fit: "Oversized", season: "Summer", formality: 1, suggestedPrice: 1199, imageKey: "blacktee" as string | null },
        { name: "Levi's Indigo Slim Jeans", category: "Jeans", slot: "bottom", color: "Blue", colorHex: "#2c4460", pattern: "Solid", material: "Stretch Denim", style: "Casual", fit: "Slim", season: "All Season", formality: 2, suggestedPrice: 2299, imageKey: null },
        { name: "Manyavar Ivory Silk Kurta", category: "Kurta", slot: "ethnic", color: "Cream", colorHex: "#efe6cf", pattern: "Embroidered", material: "Silk Blend", style: "Traditional", fit: "Regular", season: "All Season", formality: 4, suggestedPrice: 3199, imageKey: null },
        { name: "Woodland Tan Suede Loafers", category: "Loafers", slot: "shoes", color: "Brown", colorHex: "#8a6844", pattern: "Solid", material: "Suede", style: "Classic", fit: "Regular", season: "All Season", formality: 4, suggestedPrice: 3599, imageKey: null },
      ];
      const h = args.hint.toLowerCase();
      let idx = args.sampleIndex % samples.length;
      if (h.includes("kurta")) idx = 4;
      else if (h.includes("jean")) idx = 3;
      else if (h.includes("loafer") || h.includes("shoe")) idx = 5;
      else if (h.includes("tee") || h.includes("t-shirt") || h.includes("tshirt")) idx = 2;
      else if (h.includes("overshirt") || h.includes("jacket")) idx = 1;
      else if (h.includes("shirt")) idx = 0;
      const detected = samples[idx] ?? samples[0]!;
      return {
        // The guess carries a typical selling price only — MRP comes from
        // the garment's own price tag, which the user enters on the form.
        // Occasions are derived from the guess's formality band; fit,
        // occasions and everything else stay editable on the review form.
        detected: { ...detected, occasions: occasionsForFormality(detected.formality), suggestedMrp: null as number | null },
        steps: ["Looking at your photo", "Detecting category", "Detecting colour", "Understanding style & fit", "Drafting your starting guess"],
      };
    },
  }),

  analyzePurchase: defineAction({
    description: "Buy-or-Skip: scores a candidate purchase against the user's wardrobe and stores the verdict.",
    request: z.object({
      ...authFields,
      productName: z.string().min(1).max(90),
      price: z.number().min(0).max(1_000_000).default(0),
      mrp: z.number().min(0).max(1_000_000).nullable().default(null),
      color: z.string().max(30).default(""),
      slot: z.string().max(20).default("top"),
      style: z.string().max(30).default(""),
    }),
    response: z.object({
      analysis: z.object({
        id: z.number(), productName: z.string(), price: z.number(), mrp: z.number().nullable(), discountPct: z.number(), verdict: z.string(), score: z.number(),
        reasons: z.array(z.string()), cautions: z.array(z.string()), verdictText: z.string(),
        projectedOutfits: z.number(), projectedCostPerWear: z.number(),
        duplicateScore: z.number(), compatibilityScore: z.number(), versatilityScore: z.number(), wardrobeImpact: z.string(),
        confidence: z.number(), roiScore: z.number(),
      }),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const sameSlot = items.filter((i) => i.slot === args.slot);
      const sameColor = items.filter((i) => args.color && i.color.toLowerCase() === args.color.toLowerCase());
      const complements = items.filter((i) => i.slot !== args.slot && NEUTRALS.has(i.color.toLowerCase())).length;
      const dupes = sameColor.filter((i) => i.slot === args.slot);
      const occasions = new Set<string>();
      for (const i of items) {
        for (const [occ, [lo, hi]] of Object.entries(OCCASION_FORMALITY)) {
          if (i.formality >= lo - 1 && i.formality <= hi + 1) occasions.add(occ);
        }
      }
      let score = 52;
      const reasons: string[] = [];
      const cautions: string[] = [];
      const pairings = Math.min(18, complements + sameSlot.length);
      if (pairings >= 8) { score += 16; reasons.push(`Matches ${pairings} items you already own`); }
      else if (pairings >= 4) { score += 8; reasons.push(`Matches ${pairings} items you already own`); }
      const occCount = Math.min(5, Math.max(2, Math.round(occasions.size / 3)));
      score += 8; reasons.push(`Works for ${occCount} occasions`);
      const slotCount = sameSlot.length;
      const gapSlots = ["shoes", "outerwear", "ethnic"].includes(args.slot) && slotCount <= 2;
      if (gapSlots) { score += 10; reasons.push("Fills a thin spot in your wardrobe"); }
      if (NEUTRALS.has(args.color.toLowerCase())) { score += 7; reasons.push("A neutral that layers with almost everything"); }
      const buyDiscount = discountPctOf(args.price, args.mrp);
      if (buyDiscount >= 40) { score += 5; reasons.push(`${buyDiscount}% off its MRP of ₹${(args.mrp ?? 0).toLocaleString("en-IN")} — a genuine Indian-sale price`); }
      else if (buyDiscount > 0) { reasons.push(`${buyDiscount}% off MRP`); }
      if (dupes.length >= 2) { score -= 22; cautions.push(`Very similar to ${dupes.length} pieces you already own`); }
      else if (dupes.length === 1) { score -= 10; cautions.push(`Similar to your ${dupes[0]!.name}`); }
      if (args.price > 4000 && slotCount >= 3) { score -= 6; cautions.push("Premium price for a category you're already covered in"); }
      if (reasons.length < 3) reasons.push("Adds a new silhouette to your rotation");
      score = Math.max(18, Math.min(97, score));
      const verdict = score >= 72 ? "BUY" : score >= 50 ? "CONSIDER" : "SKIP";
      const projectedOutfits = Math.max(3, pairings);
      const projectedCostPerWear = args.price > 0 ? Math.round(args.price / Math.max(6, Math.round(pairings * 1.4))) : 0;
      /* The PurchaseAnalysis breakdown (Phase 11), each score computed
         from the same wardrobe facts the verdict already used:
         duplicate risk from same-slot/same-colour pieces owned,
         compatibility from real pairings, versatility from the
         occasions the wardrobe supports, impact from gap + pairings. */
      const duplicateScore = dupes.length === 0 ? 6 : dupes.length === 1 ? 48 : Math.min(92, 62 + dupes.length * 10);
      const compatibilityScore = Math.min(96, 38 + pairings * 4);
      const versatilityScore = Math.min(95, 42 + occCount * 11);
      const wardrobeImpact = gapSlots || pairings >= 10
        ? "High — fills a thin spot and pairs widely"
        : pairings >= 5
          ? "Medium — pairs with a good slice of your wardrobe"
          : "Low — limited pairings with what you own";
      const verdictText = verdict === "BUY"
        ? `Worth buying — it earns its place across ${projectedOutfits} outfits you can wear this month.`
        : verdict === "CONSIDER"
          ? "Worth it only if the fit and fabric feel distinctly better than what you own."
          : "Skip it — your wardrobe already covers this, and the money works harder elsewhere.";
      const db = ctx.db<typeof schema>();
      const rows = await db.insert(schema.buyAnalyses).values({
        userId: userId, productName: args.productName, price: args.price,
        mrp: args.mrp && args.mrp > args.price ? args.mrp : null, verdict, score,
        reasons: JSON.stringify(reasons.slice(0, 4)), cautions: JSON.stringify(cautions),
        verdictText,
      }).returning({ id: schema.buyAnalyses.id });
      const row = rows[0];
      if (!row) throw new Error("analyzePurchase failed");
      ctx.invalidateQueries();
      const analysisMrp = args.mrp && args.mrp > args.price ? args.mrp : null;
      return {
        analysis: {
          id: row.id, productName: args.productName, price: args.price, mrp: analysisMrp, discountPct: discountPctOf(args.price, analysisMrp), verdict, score,
          reasons: reasons.slice(0, 4), cautions, verdictText, projectedOutfits, projectedCostPerWear,
          duplicateScore, compatibilityScore, versatilityScore, wardrobeImpact,
          /* Intelligence Layer (§9/§13): confidence from data depth, and
             a Wardrobe ROI for the candidate — versatility and pairing
             breadth, discounted by duplicate risk. */
          confidence: confidenceFor(items.length, 0, Boolean(args.productName && args.price > 0)),
          roiScore: Math.max(8, Math.min(98, Math.round(versatilityScore * 0.5 + compatibilityScore * 0.35 + (100 - duplicateScore) * 0.15))),
        },
      };
    },
  }),

  listAnalyses: defineAction({
    description: "Lists the user's past Buy-or-Skip analyses.",
    request: z.object({ ...authFields, limit: z.number().int().min(1).max(20).default(6) }),
    response: z.object({
      analyses: z.array(z.object({
        id: z.number(), productName: z.string(), price: z.number(), mrp: z.number().nullable(), discountPct: z.number(), verdict: z.string(), score: z.number(),
        verdictText: z.string(), createdAt: z.string(),
      })),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.buyAnalyses)
        .where(eq(schema.buyAnalyses.userId, userId))
        .orderBy(desc(schema.buyAnalyses.id)).limit(args.limit);
      return {
        analyses: rows.map((r) => ({
          id: r.id, productName: r.productName, price: r.price, mrp: r.mrp ?? null, discountPct: discountPctOf(r.price, r.mrp), verdict: r.verdict, score: r.score,
          verdictText: r.verdictText, createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  }),

  getInsights: defineAction({
    description: "Computes wardrobe intelligence: health score, usage split, missing pieces, cost-per-wear extremes, and the top AI insight.",
    request: z.object({ ...authFields }),
    response: z.object({
      totalItems: z.number(), totalOutfits: z.number(), favorites: z.number(), unused: z.number(),
      health: z.number(),
      usage: z.object({ frequent: z.number(), occasional: z.number(), rare: z.number() }),
      missing: z.array(z.string()),
      bestValue: itemSchema.nullable(), worstValue: itemSchema.nullable(),
      insight: z.string(),
      dimensions: z.array(z.object({ label: z.string(), score: z.number() })),
      opportunity: z.string(),
      feed: z.array(z.string()),
      categories: z.array(z.object({
        label: z.string(), count: z.number(), mostUsed: z.string(), leastUsed: z.string(), dominantColor: z.string(),
      })),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const items = await loadItems(ctx, userId);
      const saved = await db.select().from(schema.savedOutfits).where(eq(schema.savedOutfits.userId, userId));
      const total = items.length;
      const frequent = items.filter((i) => i.wornCount >= 15).length;
      const rare = items.filter((i) => i.wornCount < 5).length;
      const occasional = Math.max(0, total - frequent - rare);
      const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
      const slots = new Set(items.map((i) => i.slot));
      const missing: string[] = [];
      if (!items.some((i) => i.slot === "shoes" && i.color.toLowerCase() === "white")) missing.push("Versatile white sneakers");
      if (!items.some((i) => i.slot === "outerwear" && i.season !== "Winter")) missing.push("Lightweight jacket");
      if (!items.some((i) => i.category.toLowerCase().includes("overshirt"))) missing.push("Neutral overshirt");
      if (!slots.has("ethnic")) missing.push("Festive ethnic set");
      if (!items.some((i) => i.formality >= 4 && i.slot === "bottom")) missing.push("Formal trousers");
      const balance = slots.size / 6;
      const health = Math.max(22, Math.min(96, Math.round(38 + balance * 30 + pct(frequent) * 0.28 - pct(rare) * 0.12)));
      const sorted = [...items].sort((a, b) => a.costPerWear - b.costPerWear);
      const stale = [...items]
        .filter((i) => (i.daysSinceWorn ?? 0) >= 14)
        .sort((a, b) => (b.daysSinceWorn ?? 0) - (a.daysSinceWorn ?? 0))[0];
      const partner = stale ? items.find((i) => i.id !== stale.id && i.slot === "bottom") : undefined;
      const insight = stale
        ? `You haven't worn your ${stale.name.toLowerCase()} in ${stale.daysSinceWorn} days.${partner ? ` Try pairing it with your ${partner.name.toLowerCase()}.` : ""}`
        : "Your rotation is healthy — everything has been worn recently.";
      const catMap = new Map<string, ItemOut[]>();
      for (const i of items) {
        const key = i.category;
        catMap.set(key, [...(catMap.get(key) ?? []), i]);
      }
      const categories = [...catMap.entries()].map(([label, list]) => {
        const byWear = [...list].sort((a, b) => b.wornCount - a.wornCount);
        const colorCount = new Map<string, number>();
        for (const i of list) colorCount.set(i.color, (colorCount.get(i.color) ?? 0) + 1);
        const dominant = [...colorCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
        return {
          label, count: list.length,
          mostUsed: byWear[0]?.name ?? "—",
          leastUsed: byWear[byWear.length - 1]?.name ?? "—",
          dominantColor: dominant,
        };
      }).sort((a, b) => b.count - a.count);
      /* Health breakdown — five honest dimensions of the same rows. */
      const versatility = Math.max(20, Math.min(97, Math.round(30 + slots.size * 9 + Math.min(20, total))));
      const usageScore = Math.max(15, Math.min(97, Math.round(100 - pct(rare) * 0.9 - (100 - pct(frequent)) * 0.15)));
      const neutralShare = total ? items.filter((i) => NEUTRALS.has(i.color.toLowerCase())).length / total : 0;
      const colorBalance = Math.max(25, Math.min(96, Math.round(96 - Math.abs(neutralShare - 0.68) * 130)));
      const coveredOccasions = Object.entries(OCCASION_FORMALITY).filter(([, [lo, hi]]) =>
        items.some((i) => i.formality >= lo && i.formality <= hi)).length;
      const occasionCoverage = Math.max(20, Math.min(97, Math.round((coveredOccasions / Object.keys(OCCASION_FORMALITY).length) * 100)));
      const dupeGroups = new Map<string, number>();
      for (const i of items) {
        const k = `${i.slot}|${i.color.toLowerCase()}`;
        dupeGroups.set(k, (dupeGroups.get(k) ?? 0) + 1);
      }
      const dupeExcess = [...dupeGroups.values()].reduce((a, n) => a + Math.max(0, n - 2), 0);
      const duplication = Math.max(22, Math.min(96, 94 - dupeExcess * 9));
      const dimensions = [
        { label: "Versatility", score: versatility },
        { label: "Usage", score: usageScore },
        { label: "Color balance", score: colorBalance },
        { label: "Occasion coverage", score: occasionCoverage },
        { label: "Duplication", score: duplication },
      ];
      const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
      const opportunity = weakest?.label === "Duplication"
        ? "You own several near-identical pieces. Before your next purchase in a covered colour, check Buy-or-Skip — the money works harder on a gap."
        : weakest?.label === "Usage"
          ? "Too much of your wardrobe sits unworn. Focus on styling the pieces you already own — start with the Use This Again list below."
          : weakest?.label === "Color balance"
            ? "Your colour mix is lopsided. One piece in an under-represented neutral would rebalance dozens of outfits."
            : weakest?.label === "Occasion coverage"
              ? "Some occasions have nothing to draw on — festive and formal moments are the thinnest. Cover those before adding more casual basics."
              : "Your wardrobe has enough casual basics. Focus your next purchase on versatile layering pieces that multiply what you own.";
      /* Dynamic insight feed — every line is computed from real rows. */
      const feed: string[] = [];
      if (stale) feed.push(`You haven't worn your ${stale.name.toLowerCase()} in ${stale.daysSinceWorn} days.`);
      const mostVersatile = [...items].sort((a, b) => b.outfitCount - a.outfitCount)[0];
      if (mostVersatile) feed.push(`Your ${mostVersatile.name.toLowerCase()} is your most versatile item — it anchors ${mostVersatile.outfitCount} outfit pairings.`);
      const colorCounts = new Map<string, number>();
      for (const i of items) if (i.slot === "top") colorCounts.set(i.color, (colorCounts.get(i.color) ?? 0) + 1);
      const heavyColor = [...colorCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (heavyColor && heavyColor[1] >= 3) feed.push(`You own ${heavyColor[1]} ${heavyColor[0].toLowerCase()} tops. Consider a different colour for your next top instead.`);
      const topGap = computeGaps(items)[0];
      if (topGap) feed.push(`Your wardrobe could create ${topGap.potentialCombos}+ more combinations with one ${topGap.title.toLowerCase()}.`);
      if (sorted[0]) feed.push(`Best value in your closet: ${sorted[0].name} at ₹${sorted[0].costPerWear.toLocaleString("en-IN")} per wear.`);
      return {
        totalItems: total,
        totalOutfits: saved.length + Math.min(24, Math.round(total * 1.4)),
        favorites: items.filter((i) => i.favorite).length,
        unused: items.filter((i) => i.wornCount < 5).length,
        health,
        usage: { frequent: pct(frequent), occasional: pct(occasional), rare: pct(rare) },
        missing: missing.slice(0, 4),
        bestValue: sorted[0] ?? null,
        worstValue: sorted.length > 1 ? sorted[sorted.length - 1]! : null,
        insight,
        dimensions,
        opportunity,
        feed: feed.slice(0, 5),
        categories,
      };
    },
  }),

  recommendProducts: defineAction({
    description: "Smart Shop: scores the real branded product catalog against the user's wardrobe compatibility.",
    request: z.object({ ...authFields }),
    response: z.object({
      products: z.array(z.object({
        id: z.string(), brand: z.string(), retailer: z.string(), productUrl: z.string(),
        name: z.string(), price: z.number(), mrp: z.number().nullable(), discountPct: z.number(), color: z.string(), colorHex: z.string(),
        category: z.string(), imageKey: z.string().nullable(),
        match: z.number(), note: z.string(),
      })),
      brandsInCatalog: z.number(),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const products = REAL_CATALOG.map((p) => {
        const owned = items.filter((i) => i.slot === p.slot && i.color.toLowerCase() === p.color.toLowerCase()).length;
        const sameBrand = items.filter((i) => i.brand === p.brand).length;
        const partners = items.filter((i) => i.slot !== p.slot).length;
        let match = 68 + Math.min(20, Math.round(partners / 2));
        if (owned > 0) match -= owned * 16;
        if (sameBrand > 0) match += 3; // proven brand fit in this wardrobe
        if (p.slot === "outerwear" && items.filter((i) => i.slot === "outerwear").length <= 3) match += 6;
        if (p.category === "Hoodie" && !items.some((i) => i.category === "Hoodie")) match += 8;
        return { id: p.id, brand: p.brand, retailer: p.retailer, productUrl: p.productUrl, name: p.name, price: p.price, mrp: p.mrp, discountPct: discountPctOf(p.price, p.mrp), color: p.color, colorHex: p.colorHex, category: p.category, imageKey: p.imageKey, match: Math.max(28, Math.min(97, match)), note: p.note };
      }).sort((a, b) => b.match - a.match);
      return { products, brandsInCatalog: new Set(REAL_CATALOG.map((p) => p.brand)).size };
    },
  }),

  listBrands: defineAction({
    description: "Returns the brand directory (major clothing brands that exist and sell in India) with live product counts from the real catalog and the user's wardrobe.",
    request: z.object({ userId: z.number().int().positive().optional(), sessionToken: z.string().min(1).max(200).optional() }),
    response: z.object({
      brands: z.array(z.object({
        name: z.string(), group: z.string(), origin: z.string(), knownFor: z.string(),
        shopCount: z.number(), ownedCount: z.number(),
      })),
      totalBrands: z.number(),
    }),
    async handler(ctx, args) {
      const userId = await optionalAuth(ctx, args);
      const owned = new Map<string, number>();
      if (userId) {
        const items = await loadItems(ctx, userId);
        for (const i of items) if (i.brand) owned.set(i.brand, (owned.get(i.brand) ?? 0) + 1);
      }
      const shop = new Map<string, number>();
      for (const p of REAL_CATALOG) shop.set(p.brand, (shop.get(p.brand) ?? 0) + 1);
      for (const w of REAL_WARDROBE) if (!shop.has(w.brand)) shop.set(w.brand, shop.get(w.brand) ?? 0);
      const brands = BRAND_DIRECTORY.map((b) => ({
        ...b,
        shopCount: shop.get(b.name) ?? 0,
        ownedCount: owned.get(b.name) ?? 0,
      }));
      return { brands, totalBrands: brands.length };
    },
  }),

  getStyleProfile: defineAction({
    description: "Style DNA: derives the user's style mix, preferred colors, fit preference, and favorite occasions from wardrobe and feedback.",
    request: z.object({ ...authFields }),
    response: z.object({
      styles: z.array(z.object({ label: z.string(), pct: z.number() })),
      colors: z.array(z.object({ name: z.string(), hex: z.string() })),
      fit: z.string(),
      occasions: z.array(z.string()),
      summary: z.string(),
      learned: z.array(z.string()),
      feedbackCount: z.number(),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const items = await loadItems(ctx, userId);
      const fb = await db.select().from(schema.feedback).where(eq(schema.feedback.userId, userId));
      /* Style DNA affinities — six canonical style dimensions, each an
         affinity score (0–100) derived from what you own and wear most,
         not a share that must sum to 100. */
      const CANON_STYLES = ["Minimal", "Casual", "Smart Casual", "Streetwear", "Classic", "Traditional"] as const;
      const totalWear = items.reduce((a, i) => a + i.wornCount + 2, 0) || 1;
      const affinity = (label: string): number => {
        let n = 0;
        for (const i of items) {
          const w = i.wornCount + 2;
          if (i.style === label) n += w;
          else if (label === "Minimal" && NEUTRALS.has(i.color.toLowerCase())) n += w * 0.35;
          else if (label === "Casual" && i.style === "Smart Casual") n += w * 0.3;
          else if (label === "Smart Casual" && i.style === "Casual") n += w * 0.3;
          else if (label === "Traditional" && i.slot === "ethnic") n += w * 1.4;
          else if (label === "Classic" && i.formality >= 4) n += w * 0.35;
          else if (label === "Streetwear" && (i.category === "T-Shirt" || i.category === "Hoodie")) n += w * 0.3;
        }
        return Math.max(24, Math.min(96, Math.round(28 + (n / totalWear) * 155)));
      };
      const styles = CANON_STYLES.map((label) => ({ label, pct: affinity(label) })).sort((a, b) => b.pct - a.pct);
      const colorCount = new Map<string, { hex: string; n: number }>();
      for (const i of items) {
        const cur = colorCount.get(i.color) ?? { hex: i.colorHex, n: 0 };
        cur.n += i.wornCount + 1;
        colorCount.set(i.color, cur);
      }
      const colors = [...colorCount.entries()]
        .map(([name, v]) => ({ name, hex: v.hex, n: v.n }))
        .sort((a, b) => b.n - a.n).slice(0, 5)
        .map(({ name, hex }) => ({ name, hex }));
      const neutralShare = items.length
        ? items.filter((i) => NEUTRALS.has(i.color.toLowerCase())).length / items.length
        : 0;
      const summary = `Your style is relaxed, ${neutralShare > 0.6 ? "minimal and versatile" : "expressive and varied"}, with a preference for ${colors.slice(0, 2).map((c) => c.name.toLowerCase()).join(" and ") || "neutral"} tones.`;
      /* Preferred fit — the wear-weighted mode of the fits actually in
         the wardrobe (Phase 4: derived, never hardcoded). */
      const fitWeights = new Map<string, number>();
      for (const i of items) fitWeights.set(i.fit, (fitWeights.get(i.fit) ?? 0) + i.wornCount + 1);
      const fit = [...fitWeights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Regular";
      /* Favourite occasions — from the outfits the user actually saved;
         until any exist, the occasions their wardrobe covers best. */
      const saved = await db.select().from(schema.savedOutfits).where(eq(schema.savedOutfits.userId, userId));
      const occCounts = new Map<string, number>();
      for (const o of saved) if (o.occasion) occCounts.set(o.occasion, (occCounts.get(o.occasion) ?? 0) + 1);
      if (occCounts.size === 0) {
        for (const i of items) for (const occ of i.occasions) occCounts.set(occ, (occCounts.get(occ) ?? 0) + i.wornCount + 1);
      }
      const occasions = [...occCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([occ]) => occ);
      /* Learned line — from the ratings actually stored, like
         recordFeedback's note; no canned preference claims. */
      const lovedStyles = fb
        .filter((f) => f.kind === "love" || f.kind === "liked" || f.kind === "good")
        .map((f) => styleFromFeedbackDetail(f.detail))
        .filter(Boolean);
      const lovedCounts = new Map<string, number>();
      for (const s of lovedStyles) lovedCounts.set(s, (lovedCounts.get(s) ?? 0) + 1);
      const topLoved = [...lovedCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const learned = [
        topLoved
          ? `Your highest-rated looks lean ${topLoved} — the stylist weights ${topLoved} pieces higher now.`
          : `${Math.round(neutralShare * 100)}% of your wardrobe is neutral-toned — that's the base your outfits build on.`,
        fb.length > 0
          ? `Learned from ${fb.length} of your choices so far — every outfit you wear or save sharpens this.`
          : "Wear an outfit or save one, and WearWise starts learning from the choice.",
      ];
      return {
        styles,
        colors,
        fit,
        occasions,
        summary,
        learned,
        feedbackCount: fb.length,
      };
    },
  }),

  /* ---------------- Extended AI services (demo intelligence layer) ----
     Each action below is a clean service seam: deterministic over the
     user's real wardrobe rows today, replaceable by a real vision / LLM /
     weather / shopping API later without changing the client contract. */

  getWeatherOutfit: defineAction({
    description: "Weather Stylist: returns today's demo weather card and an outfit from the user's wardrobe suited to it (weatherService seam — swap in a live weather API later).",
    request: z.object({ ...authFields, seed: z.number().int().min(0).default(0) }),
    response: z.object({
      weather: z.object({
        temp: z.number(), feelsLike: z.number(), humidity: z.number(), rainChance: z.number(),
        condition: z.string(), advice: z.string(),
      }),
      outfit: outfitSchema,
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const weather = { temp: 24, feelsLike: 26, humidity: 61, rainChance: 20, condition: "Warm & bright" };
      const outfit = buildOutfit(items, "Casual", "Warm", "Smart Casual", args.seed);
      const names = outfit.items.slice(0, 2).map((i) => `your ${i.name.toLowerCase()}`).join(" with ");
      const advice = outfit.items.length
        ? `It's warm today, so skip the heavy jacket. ${names.charAt(0).toUpperCase() + names.slice(1)} would work well — light layers, breathable fabrics, and only a ${weather.rainChance}% chance of rain.`
        : "It's warm today — add a few light pieces to your wardrobe and WearWise will style the day for you.";
      return { weather: { ...weather, advice }, outfit };
    },
  }),

  analyzeOutfitPhoto: defineAction({
    description: "Snap & Style (analyzeOutfit): scores a photographed outfit and returns clickable improvement suggestions anchored on pieces the user actually owns.",
    request: z.object({
      ...authFields,
      hint: z.string().max(120).default(""),
      sampleIndex: z.number().int().min(0).max(11).default(0),
    }),
    response: z.object({
      score: z.number(),
      breakdown: z.array(z.object({ label: z.string(), score: z.number() })),
      analysis: z.string(),
      suggestions: z.array(z.object({
        id: z.string(), text: z.string(), slot: z.string(),
        swapItem: itemSchema.nullable(),
      })),
      look: z.array(itemSchema),
      steps: z.array(z.string()),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const seed = args.sampleIndex;
      const pickSlot = (slot: string, offset = 0) => {
        const pool = items.filter((i) => i.slot === slot);
        return pool.length ? pool[Math.abs(seed + offset) % pool.length]! : null;
      };
      const look: ItemOut[] = [];
      const t = pickSlot("top") ?? pickSlot("ethnic");
      if (t) look.push(t);
      const b = pickSlot("bottom", 1);
      if (b && t?.slot !== "ethnic") look.push(b);
      const s = pickSlot("shoes", 2);
      if (s) look.push(s);
      const variance = (seed * 7) % 9;
      const breakdown = [
        { label: "Color", score: Math.min(96, 84 + variance) },
        { label: "Fit", score: Math.max(62, 78 - (seed % 4)) },
        { label: "Occasion", score: Math.min(95, 85 + (seed % 5)) },
        { label: "Style", score: Math.min(94, 79 + variance) },
      ];
      const score = Math.round(breakdown.reduce((a, x) => a + x.score, 0) / breakdown.length);
      const whiteShoes = items.find((i) => i.slot === "shoes" && i.color.toLowerCase() === "white")
        ?? items.filter((i) => i.slot === "shoes").sort((a, b) => b.wornCount - a.wornCount)[0] ?? null;
      const accessory = items.find((i) => i.slot === "accessory") ?? null;
      const overshirt = items.find((i) => i.category.toLowerCase().includes("overshirt"))
        ?? items.filter((i) => i.slot === "outerwear" && ["cream", "beige"].includes(i.color.toLowerCase()))[0] ?? null;
      const suggestions = [
        {
          id: "shoes", slot: "shoes", swapItem: whiteShoes,
          text: whiteShoes ? `Try your ${whiteShoes.name.toLowerCase()} instead — a brighter base lifts the whole look.` : "Try lighter footwear — a brighter base lifts the whole look.",
        },
        {
          id: "accessory", slot: "accessory", swapItem: accessory,
          text: accessory ? `Add your ${accessory.name.toLowerCase()} — one finishing detail is all this outfit is missing.` : "Add a minimal black watch — one finishing detail is all this outfit is missing.",
        },
        {
          id: "layer", slot: "outerwear", swapItem: overshirt,
          text: overshirt ? `Swap the jacket for your ${overshirt.name.toLowerCase()} — softer contrast, same structure.` : "Swap the jacket for a lighter overshirt — softer contrast, same structure.",
        },
      ];
      return {
        score,
        breakdown,
        analysis: "The colors work well together, but the outfit could benefit from a stronger contrast. The fit reads relaxed and intentional — one brighter or more structured piece would sharpen it.",
        suggestions,
        look,
        steps: ["Scanning your outfit photo", "Reading colours & fit", "Scoring against the occasion", "Finding upgrades you already own"],
      };
    },
  }),

  detectDuplicates: defineAction({
    description: "Duplicate Detector: finds the wardrobe items most similar to a candidate purchase, with similarity scores.",
    request: z.object({
      ...authFields,
      productName: z.string().min(1).max(90),
      color: z.string().max(30).default(""),
      slot: z.string().max(20).default("top"),
      style: z.string().max(30).default(""),
    }),
    response: z.object({
      similar: z.array(z.object({ item: itemSchema, similarity: z.number() })),
      count: z.number(),
      message: z.string(),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const nameWords = args.productName.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
      const scored = items.map((i) => {
        let sim = 8;
        if (i.slot === args.slot) sim += 34;
        if (args.color && i.color.toLowerCase() === args.color.toLowerCase()) sim += 30;
        if (args.style && i.style === args.style) sim += 14;
        if (nameWords.some((w) => i.name.toLowerCase().includes(w) || i.category.toLowerCase().includes(w))) sim += 12;
        if (NEUTRALS.has(i.color.toLowerCase()) && NEUTRALS.has(args.color.toLowerCase())) sim += 4;
        return { item: i, similarity: Math.min(96, sim) };
      }).filter((x) => x.similarity >= 40).sort((a, b) => b.similarity - a.similarity).slice(0, 3);
      return {
        similar: scored,
        count: scored.length,
        message: scored.length
          ? `You already own ${scored.length} item${scored.length > 1 ? "s" : ""} with similar characteristics.`
          : "Nothing in your wardrobe is a close match — this would be genuinely new.",
      };
    },
  }),

  getWardrobeGaps: defineAction({
    description: "Wardrobe Gap Analysis (analyzeWardrobeGaps): what the wardrobe is missing, why, and how many combinations each gap would unlock.",
    request: z.object({ ...authFields }),
    response: z.object({ gaps: z.array(z.object({ title: z.string(), reason: z.string(), potentialCombos: z.number(), slot: z.string(), category: z.string() })) }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      return { gaps: computeGaps(items) };
    },
  }),

  generatePackingList: defineAction({
    description: "Packing Assistant (generatePackingList): builds a capsule packing list from the user's own wardrobe for a destination, duration and trip type, plus outfits from the packed pieces.",
    request: z.object({
      ...authFields,
      destination: z.string().min(1).max(60),
      days: z.number().int().min(1).max(30),
      tripType: z.string().min(1).max(30),
    }),
    response: z.object({
      groups: z.array(z.object({ label: z.string(), entries: z.array(z.object({ label: z.string(), owned: z.boolean() })) })),
      itemCount: z.number(),
      outfitCount: z.number(),
      outfits: z.array(outfitSchema),
      note: z.string(),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const beach = args.tripType.toLowerCase().includes("beach");
      const party = args.tripType.toLowerCase().includes("party");
      const festive = args.tripType.toLowerCase().includes("festive") || args.tripType.toLowerCase().includes("wedding");
      const tops = items.filter((i) => i.slot === "top");
      const ethnics = items.filter((i) => i.slot === "ethnic");
      const bottoms = items.filter((i) => i.slot === "bottom");
      const shoes = items.filter((i) => i.slot === "shoes");
      const layers = items.filter((i) => i.slot === "outerwear");
      const teeCount = Math.max(1, Math.min(args.days, tops.filter((i) => i.category === "T-Shirt").length || Math.ceil(args.days * 0.75)));
      const entries = (label: string, ownedPool: ItemOut[], want: number) =>
        ownedPool.slice(0, want).map((i) => ({ label: i.name, owned: true }))
          .concat(Array.from({ length: Math.max(0, want - ownedPool.length) }, () => ({ label, owned: false })));
      const clothing = [
        ...entries("T-shirt", tops.filter((i) => i.category === "T-Shirt"), teeCount).map((e) => ({ ...e, label: e.owned ? e.label : `${teeCount} T-shirts (pack your favourites)` })),
        ...entries("Linen shirt", tops.filter((i) => i.category === "Shirt"), 1).map((e) => ({ ...e, label: e.owned ? e.label : "1 linen shirt" })),
        ...(festive ? entries("Kurta set", ethnics, 1) : []),
        ...entries(beach ? "Shorts / light bottoms" : "Jeans", bottoms, Math.min(2, Math.max(1, bottoms.length))).map((e, ix) => ({ ...e, label: e.owned ? e.label : ix === 0 ? "2 shorts" : "1 jeans" })),
        ...(party && layers[0] ? [{ label: layers[0].name, owned: true }] : []),
      ];
      const footwear = entries("Sneakers", shoes, beach ? 2 : 1).map((e, ix) => ({ ...e, label: e.owned ? e.label : ix === 0 ? "Sneakers" : "Sandals" }));
      const accessories = [
        { label: "Sunglasses", owned: items.some((i) => i.slot === "accessory") },
        { label: "Watch", owned: items.some((i) => i.slot === "accessory") },
        { label: "Cap", owned: false },
      ];
      const packed = [...new Set([...tops.slice(0, teeCount + 1), ...bottoms.slice(0, 2), ...shoes.slice(0, 2), ...(festive ? ethnics.slice(0, 1) : [])].map((i) => i.id))]
        .map((id) => items.find((i) => i.id === id)!).filter(Boolean);
      const outfits: z.infer<typeof outfitSchema>[] = [];
      const pTops = packed.filter((i) => i.slot === "top" || i.slot === "ethnic");
      const pBottoms = packed.filter((i) => i.slot === "bottom");
      const pShoes = packed.filter((i) => i.slot === "shoes");
      for (let k = 0; k < Math.min(5, Math.max(1, pTops.length)); k++) {
        const anchor = pTops[k % Math.max(1, pTops.length)];
        if (!anchor) break;
        const combo: ItemOut[] = [anchor];
        if (anchor.slot !== "ethnic" && pBottoms.length) combo.push(pBottoms[k % pBottoms.length]!);
        if (pShoes.length) combo.push(pShoes[k % pShoes.length]!);
        outfits.push(scoreOutfitItems(combo, args.tripType.includes("Party") ? "Party" : "Travel", beach ? "Hot" : "Warm", "Casual"));
      }
      const itemCount = clothing.length + footwear.length + accessories.length;
      return {
        groups: [
          { label: "Clothing", entries: clothing },
          { label: "Footwear", entries: footwear },
          { label: "Accessories", entries: accessories },
        ],
        itemCount,
        outfitCount: Math.max(outfits.length, Math.min(9, pTops.length * Math.max(1, pBottoms.length))),
        outfits,
        note: `${args.destination} for ${args.days} days — packed light on purpose: every piece below mixes with every other, so a small bag still covers the whole trip.`,
      };
    },
  }),

  getUseAgain: defineAction({
    description: "Use This Again: finds neglected wardrobe pieces and builds three complete outfits around each.",
    request: z.object({ ...authFields, offset: z.number().int().min(0).default(0) }),
    response: z.object({
      entries: z.array(z.object({
        item: itemSchema, days: z.number(),
        looks: z.array(z.object({ occasion: z.string(), outfit: outfitSchema })),
      })),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const neglected = items
        .filter((i) => (i.daysSinceWorn ?? 0) >= 14)
        .sort((a, b) => (b.daysSinceWorn ?? 0) - (a.daysSinceWorn ?? 0));
      const chosen = neglected.slice(args.offset % Math.max(1, neglected.length), (args.offset % Math.max(1, neglected.length)) + 2);
      const pool = chosen.length ? chosen : neglected.slice(0, 2);
      return {
        entries: pool.map((item) => ({
          item,
          days: item.daysSinceWorn ?? 0,
          looks: ["Casual", "College", "Date"].map((occasion) => ({
            occasion: occasion === "Date" ? "Evening" : occasion,
            outfit: buildAnchoredOutfit(items, item, occasion === "Date" ? "Date" : occasion, "Warm", item.style || "Casual"),
          })),
        })),
      };
    },
  }),

  simulatePurchase: defineAction({
    description: "What If I Bought This: simulates a candidate product against the wardrobe — outfits it would join, combinations added, and duplication level.",
    request: z.object({
      ...authFields,
      productName: z.string().min(1).max(90),
      color: z.string().max(30).default(""),
      slot: z.string().max(20).default("top"),
      style: z.string().max(30).default(""),
      price: z.number().min(0).max(1_000_000).default(0),
    }),
    response: z.object({
      worksWith: z.array(z.string()),
      outfits: z.array(z.object({ title: z.string(), pieces: z.array(z.string()), score: z.number() })),
      combosAdded: z.number(),
      newCategories: z.number(),
      duplication: z.string(),
      verdict: z.string(),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const partners = items.filter((i) => i.slot !== args.slot)
        .sort((a, b) => (NEUTRALS.has(b.color.toLowerCase()) ? 1 : 0) - (NEUTRALS.has(a.color.toLowerCase()) ? 1 : 0) || b.wornCount - a.wornCount);
      const worksWith = partners.slice(0, 5).map((i) => i.name);
      const bottoms = partners.filter((i) => i.slot === "bottom");
      const shoes = partners.filter((i) => i.slot === "shoes");
      const tops = partners.filter((i) => i.slot === "top" || i.slot === "ethnic");
      const outfits: Array<{ title: string; pieces: string[]; score: number }> = [];
      for (let k = 0; k < 5; k++) {
        const pieces = [args.productName];
        if (args.slot !== "bottom" && bottoms.length) pieces.push(bottoms[k % bottoms.length]!.name);
        if (args.slot !== "shoes" && shoes.length) pieces.push(shoes[k % shoes.length]!.name);
        if ((args.slot === "bottom" || args.slot === "shoes") && tops.length) pieces.push(tops[k % tops.length]!.name);
        outfits.push({ title: `Look ${k + 1}`, pieces, score: Math.max(74, Math.min(96, 92 - k * 3)) });
      }
      const dupes = items.filter((i) => i.slot === args.slot && args.color && i.color.toLowerCase() === args.color.toLowerCase()).length;
      const combosAdded = Math.max(4, partners.length + bottoms.length);
      return {
        worksWith,
        outfits,
        combosAdded,
        newCategories: items.some((i) => i.slot === args.slot) ? 1 : 2,
        duplication: dupes >= 2 ? "High duplication" : dupes === 1 ? "Some duplication" : "Low duplication",
        verdict: dupes >= 2 ? "SKIP" : "BUY",
      };
    },
  }),

  remixOutfit: defineAction({
    description: "Outfit Remix (generateOutfitRemix): keeps an outfit's style but swaps 1–2 pieces, returning three scored alternatives to compare.",
    request: z.object({
      ...authFields,
      itemIds: z.array(z.number().int().positive()).min(1).max(8),
      occasion: z.string().min(1).max(30),
      weather: z.string().min(1).max(20).default("Warm"),
      style: z.string().min(1).max(30).default("Smart Casual"),
    }),
    response: z.object({ remixes: z.array(z.object({ outfit: outfitSchema, changed: z.string() })) }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const byId = new Map(items.map((i) => [i.id, i]));
      const original = args.itemIds.map((id) => byId.get(id)).filter((i): i is ItemOut => Boolean(i));
      const remixes: Array<{ outfit: z.infer<typeof outfitSchema>; changed: string }> = [];
      const swappable = original.filter((i) => ["top", "ethnic", "bottom", "shoes", "outerwear"].includes(i.slot));
      for (let k = 0; k < Math.min(3, swappable.length); k++) {
        const target = swappable[k]!;
        const alt = items
          .filter((i) => i.slot === target.slot && !args.itemIds.includes(i.id))
          .sort((a, b) => b.wornCount - a.wornCount)[0];
        if (!alt) continue;
        const next = original.map((i) => (i.id === target.id ? alt : i));
        remixes.push({
          outfit: scoreOutfitItems(next, args.occasion, args.weather, args.style),
          changed: `${target.name} → ${alt.name}`,
        });
      }
      return { remixes };
    },
  }),

  transformItem: defineAction({
    description: "Occasion Transformer: takes one wardrobe item and restyles it for College, Interview, Date, Party and Wedding.",
    request: z.object({ ...authFields, itemId: z.number().int().positive() }),
    response: z.object({
      item: itemSchema.nullable(),
      looks: z.array(z.object({ occasion: z.string(), outfit: outfitSchema })),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const item = items.find((i) => i.id === args.itemId) ?? null;
      if (!item) return { item: null, looks: [] };
      const plan: Array<[string, string]> = [
        ["College", "Casual"], ["Interview", "Classic"], ["Date", "Smart Casual"], ["Party", "Trendy"], ["Wedding", "Traditional"],
      ];
      return {
        item,
        looks: plan.map(([occasion, style]) => ({
          occasion,
          outfit: buildAnchoredOutfit(items, item, occasion, "Warm", style),
        })),
      };
    },
  }),

  recommendAccessories: defineAction({
    description: "Accessory Recommender: context-aware finishing touches for a generated outfit.",
    request: z.object({
      ...authFields,
      itemIds: z.array(z.number().int().positive()).min(1).max(8),
      occasion: z.string().max(30).default("Casual"),
    }),
    response: z.object({
      note: z.string(),
      suggestions: z.array(z.object({ type: z.string(), name: z.string(), reason: z.string(), owned: z.boolean() })),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const byId = new Map(items.map((i) => [i.id, i]));
      const outfitItems = args.itemIds.map((id) => byId.get(id)).filter((i): i is ItemOut => Boolean(i));
      const ownedAcc = items.filter((i) => i.slot === "accessory");
      const formal = outfitItems.some((i) => i.formality >= 4) || ["Interview", "Wedding"].includes(args.occasion);
      const hasShoes = outfitItems.some((i) => i.slot === "shoes");
      const suggestions: Array<{ type: string; name: string; reason: string; owned: boolean }> = [];
      const watch = ownedAcc.find((i) => i.name.toLowerCase().includes("watch"));
      suggestions.push({
        type: "Watch",
        name: watch?.name ?? "Minimal black watch",
        reason: formal ? "A clean watch face matches the formality and finishes the wrist line." : "Your outfit is already balanced — a minimal watch completes it without adding visual weight.",
        owned: Boolean(watch),
      });
      suggestions.push({
        type: "Belt",
        name: "Matte black belt",
        reason: outfitItems.some((i) => i.slot === "bottom" && i.formality >= 3) ? "Your trousers sit at smart formality — a matched belt keeps the line unbroken." : "Only if you tuck the top in; otherwise skip it and keep the relaxed line.",
        owned: ownedAcc.some((i) => i.name.toLowerCase().includes("belt")),
      });
      suggestions.push({
        type: "Sunglasses",
        name: "Classic wayfarer sunglasses",
        reason: ["Travel", "College", "Casual", "Date"].includes(args.occasion) ? "Daylight occasion — sunglasses add the one deliberate accent this palette can carry." : "Evening or indoor setting — leave sunglasses off this one.",
        owned: ownedAcc.some((i) => i.name.toLowerCase().includes("sunglass")),
      });
      if (!hasShoes) suggestions.push({ type: "Shoes", name: "Clean white sneakers", reason: "No footwear in the look yet — start from your most versatile pair.", owned: items.some((i) => i.slot === "shoes") });
      return {
        note: formal
          ? "This look leans formal, so accessories should whisper, not shout — one metal accent is enough."
          : "Your outfit is already balanced. One minimal accessory completes the look without adding too much visual weight.",
        suggestions: suggestions.slice(0, 3),
      };
    },
  }),

  recordFeedback: defineAction({
    description: "Personalization Engine: stores outfit feedback (love / good / unsure / not my style) so WearWise learns the user's taste.",
    request: z.object({
      ...authFields,
      rating: z.enum(["love", "good", "unsure", "not"]),
      detail: z.string().max(200).default(""),
    }),
    response: z.object({ ok: z.literal(true), learnedNote: z.string(), feedbackCount: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; learnedNote: string; feedbackCount: number }> {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      await db.insert(schema.feedback).values({ userId: userId, kind: args.rating, detail: args.detail });
      const fb = await db.select().from(schema.feedback).where(eq(schema.feedback.userId, userId));
      // The learned note is derived from the ratings actually stored:
      // the style that appears most often in loved/liked outfit titles.
      const lovedStyles = fb
        .filter((f) => f.kind === "love" || f.kind === "liked" || f.kind === "good")
        .map((f) => styleFromFeedbackDetail(f.detail))
        .filter(Boolean);
      const styleCounts = new Map<string, number>();
      for (const s of lovedStyles) styleCounts.set(s, (styleCounts.get(s) ?? 0) + 1);
      const topLoved = [...styleCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const learnedNote = topLoved
        ? `Your highest-rated looks lean ${topLoved} — WearWise now weights ${topLoved} pieces higher when it styles you. (${fb.length} learning signals so far.)`
        : `Noted — ${fb.length} learning signal${fb.length === 1 ? "" : "s"} so far. Love a look and WearWise starts weighting that style higher.`;
      ctx.invalidateQueries();
      return { ok: true, learnedNote, feedbackCount: fb.length };
    },
  }),

  getFeedbackHistory: defineAction({
    description: "Personalization: returns the user's stored learning signals (outfit ratings, worn and saved events), newest first, for the feedback history view.",
    request: z.object({ ...authFields, limit: z.number().int().min(1).max(50).default(12) }),
    response: z.object({
      entries: z.array(z.object({
        id: z.number(), kind: z.string(), detail: z.string(), createdAt: z.string(),
      })),
      total: z.number(),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.feedback)
        .where(eq(schema.feedback.userId, userId))
        .orderBy(desc(schema.feedback.createdAt));
      return {
        entries: rows.slice(0, args.limit).map((r) => ({
          id: r.id, kind: r.kind, detail: r.detail, createdAt: r.createdAt.toISOString(),
        })),
        total: rows.length,
      };
    },
  }),

  /* ---------------- Unique features (Repeat Radar et al.) ----------- */

  logWear: defineAction({
    description: "Repeat Radar: logs an outfit as worn today with its social context (occasion, audience, location), bumps the pieces' wear counts, and reports whether that audience has already seen this look.",
    request: z.object({
      ...authFields,
      itemIds: z.array(z.number().int().positive()).min(1).max(8),
      occasion: z.string().max(40).default(""),
      audience: z.string().max(60).default(""),
      location: z.string().max(60).default(""),
    }),
    response: z.object({
      ok: z.literal(true),
      repeat: z.object({ isRepeat: z.boolean(), message: z.string(), daysAgo: z.number().nullable(), sameAudienceCount: z.number() }),
    }),
    async handler(ctx, args): Promise<{ ok: true; repeat: { isRepeat: boolean; message: string; daysAgo: number | null; sameAudienceCount: number } }> {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const items = await loadItems(ctx, userId);
      const byId = new Map(items.map((i) => [i.id, i]));
      const prior = await db.select().from(schema.wearLogs)
        .where(eq(schema.wearLogs.userId, userId))
        .orderBy(desc(schema.wearLogs.wornAt));
      const sameAud = prior.filter((l) => sameAudience(l.audience, args.audience));
      const repeatLog = sameAud.find((l) => outfitsRepeat(args.itemIds, parseItemIds(l.itemIds), byId));
      const daysAgo = repeatLog ? Math.floor((now() - repeatLog.wornAt.getTime()) / DAY) : null;
      const repeat = {
        isRepeat: Boolean(repeatLog),
        daysAgo,
        sameAudienceCount: sameAud.length,
        message: repeatLog
          ? `Heads up — ${args.audience} already saw this look ${daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`} (${repeatLog.occasion}${repeatLog.location ? ` · ${repeatLog.location}` : ""}). Logged anyway — the radar just keeps you informed.`
          : args.audience.trim()
            ? `Fresh look for ${args.audience} — they haven't seen this combination before. Logged.`
            : "Logged. Add who saw it next time and Repeat Radar can warn you before a repeat.",
      };
      await db.insert(schema.wearLogs).values({
        userId: userId, itemIds: JSON.stringify(args.itemIds),
        occasion: args.occasion, audience: args.audience.trim(), location: args.location.trim(),
        wornAt: new Date(),
      });
      const rows = await db.select().from(schema.wardrobeItems).where(eq(schema.wardrobeItems.userId, userId));
      for (const r of rows) {
        if (args.itemIds.includes(r.id)) {
          await db.update(schema.wardrobeItems)
            .set({ wornCount: r.wornCount + 1, lastWornAt: new Date() })
            .where(eq(schema.wardrobeItems.id, r.id));
        }
      }
      await db.insert(schema.feedback).values({
        userId: userId, kind: "worn",
        detail: `Wore ${args.itemIds.length} pieces${args.occasion ? ` for ${args.occasion}` : ""}${args.audience.trim() ? ` · seen by ${args.audience.trim()}` : ""}`,
      });
      ctx.invalidateQueries();
      return { ok: true, repeat };
    },
  }),

  getRepeatRadar: defineAction({
    description: "Repeat Radar: returns the user's wear history with social context, per-audience repeat warnings, and — when itemIds + audience are passed — a repeat check for a planned outfit.",
    request: z.object({
      ...authFields,
      itemIds: z.array(z.number().int().positive()).max(8).optional(),
      audience: z.string().max(60).optional(),
    }),
    response: z.object({
      history: z.array(z.object({
        id: z.number(), occasion: z.string(), audience: z.string(), location: z.string(),
        wornAt: z.string(), daysAgo: z.number(), items: z.array(itemSchema),
      })),
      warnings: z.array(z.object({
        audience: z.string(), occasion: z.string(), daysAgo: z.number(),
        risk: z.string(), message: z.string(), itemNames: z.array(z.string()),
      })),
      audiences: z.array(z.string()),
      trackedWears: z.number(),
      check: z.object({ isRepeat: z.boolean(), message: z.string(), daysAgo: z.number().nullable() }).nullable(),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const items = await loadItems(ctx, userId);
      const byId = new Map(items.map((i) => [i.id, i]));
      const logs = await db.select().from(schema.wearLogs)
        .where(eq(schema.wearLogs.userId, userId))
        .orderBy(desc(schema.wearLogs.wornAt));
      const history = logs.map((l) => ({
        id: l.id, occasion: l.occasion, audience: l.audience, location: l.location,
        wornAt: l.wornAt.toISOString(),
        daysAgo: Math.floor((now() - l.wornAt.getTime()) / DAY),
        items: parseItemIds(l.itemIds).map((id) => byId.get(id)).filter((i): i is ItemOut => Boolean(i)),
      })).filter((h) => h.items.length > 0);
      /* One warning per audience: their most recent look, if repeating
         it now would land inside the 30-day repeat window. */
      const byAudience = new Map<string, typeof history[number]>();
      for (const h of history) {
        const key = h.audience.trim().toLowerCase();
        if (key && !byAudience.has(key)) byAudience.set(key, h);
      }
      const warnings = [...byAudience.values()]
        .filter((h) => h.daysAgo <= 30)
        .map((h) => ({
          audience: h.audience, occasion: h.occasion, daysAgo: h.daysAgo,
          risk: h.daysAgo <= 14 ? "High" : "Medium",
          message: h.daysAgo <= 14
            ? `${h.audience} saw this look just ${h.daysAgo === 0 ? "today" : `${h.daysAgo} days ago`} — wearing it to them again this soon is the repeat people actually notice. Swap one core piece first.`
            : `${h.audience} saw this look ${h.daysAgo} days ago. Inside a month, the same crowd will likely remember it — a different top or layer resets it.`,
          itemNames: h.items.map((i) => i.name),
        }))
        .slice(0, 4);
      let check: { isRepeat: boolean; message: string; daysAgo: number | null } | null = null;
      if (args.itemIds?.length && args.audience?.trim()) {
        const match = history.find((h) => sameAudience(h.audience, args.audience!) && outfitsRepeat(args.itemIds!, h.items.map((i) => i.id), byId));
        check = match
          ? { isRepeat: true, daysAgo: match.daysAgo, message: `⚠ Repeat — ${args.audience} saw this combination ${match.daysAgo === 0 ? "today" : match.daysAgo === 1 ? "yesterday" : `${match.daysAgo} days ago`} (${match.occasion}${match.location ? ` · ${match.location}` : ""}). Change the top or the bottom and it reads as a new outfit.` }
          : { isRepeat: false, daysAgo: null, message: `✓ You're clear — ${args.audience} hasn't seen this combination before${history.some((h) => sameAudience(h.audience, args.audience!)) ? "" : " (in fact, they have no logged wears yet)"}.` };
      }
      return {
        history: history.slice(0, 10),
        warnings,
        audiences: [...new Set(history.map((h) => h.audience).filter(Boolean))],
        trackedWears: history.length,
        check,
      };
    },
  }),

  getSevenWays: defineAction({
    description: "One Item, 7 Ways: builds seven complete outfits around one neglected wardrobe piece (or the most neglected by default) and lists the other neglected candidates.",
    request: z.object({ ...authFields, itemId: z.number().int().positive().nullable().default(null) }),
    response: z.object({
      item: itemSchema.nullable(),
      candidates: z.array(z.object({ item: itemSchema, daysSince: z.number() })),
      outfits: z.array(z.object({ label: z.string(), occasion: z.string(), outfit: outfitSchema })),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const neglected = [...items]
        .sort((a, b) => (b.daysSinceWorn ?? 999) - (a.daysSinceWorn ?? 999) || a.wornCount - b.wornCount);
      const item = (args.itemId ? items.find((i) => i.id === args.itemId) : undefined) ?? neglected[0] ?? null;
      if (!item) return { item: null, candidates: [], outfits: [] };
      const plan: Array<[string, string, string, string]> = [
        ["College Reset", "College", "Warm", "Casual"],
        ["Interview Sharp", "Interview", "Warm", "Classic"],
        ["Date Night", "Date", "Warm", "Smart Casual"],
        ["Party Mode", "Party", "Warm", "Trendy"],
        ["Wedding Guest", "Wedding", "Warm", "Traditional"],
        ["Travel Light", "Travel", "Warm", "Casual"],
        ["Festive Glow", "Festive", "Warm", "Traditional"],
      ];
      return {
        item,
        candidates: neglected.slice(0, 6).map((i) => ({ item: i, daysSince: i.daysSinceWorn ?? 0 })),
        outfits: plan.map(([label, occasion, weather, style]) => ({
          label, occasion,
          outfit: buildAnchoredOutfit(items, item, occasion, weather, style),
        })),
      };
    },
  }),

  getChallenge: defineAction({
    description: "One Item, 7 Ways challenge: returns the user's active 30-day challenge (wear one piece on 7 different days) with progress and streak.",
    request: z.object({ ...authFields }),
    response: z.object({
      challenge: z.object({
        id: z.number(), item: itemSchema, startedAt: z.string(), targetDays: z.number(), targetWears: z.number(),
        wearsLogged: z.number(), streak: z.number(), daysElapsed: z.number(), daysLeft: z.number(),
        status: z.string(), progressPct: z.number(),
      }).nullable(),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const items = await loadItems(ctx, userId);
      const byId = new Map(items.map((i) => [i.id, i]));
      const rows = await db.select().from(schema.itemChallenges)
        .where(and(eq(schema.itemChallenges.userId, userId), eq(schema.itemChallenges.status, "active")))
        .orderBy(desc(schema.itemChallenges.id));
      const row = rows[0];
      if (!row) return { challenge: null };
      const item = byId.get(row.itemId);
      if (!item) return { challenge: null };
      const daysElapsed = Math.max(0, Math.floor((now() - row.startedAt.getTime()) / DAY));
      return {
        challenge: {
          id: row.id, item, startedAt: row.startedAt.toISOString(),
          targetDays: row.targetDays, targetWears: row.targetWears,
          wearsLogged: row.wearsLogged, streak: row.streak,
          daysElapsed, daysLeft: Math.max(0, row.targetDays - daysElapsed),
          status: row.status,
          progressPct: Math.min(100, Math.round((row.wearsLogged / Math.max(1, row.targetWears)) * 100)),
        },
      };
    },
  }),

  startChallenge: defineAction({
    description: "Starts (or replaces) the user's One Item, 7 Ways 30-day challenge for a chosen wardrobe piece.",
    request: z.object({ ...authFields, itemId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      await db.update(schema.itemChallenges)
        .set({ status: "replaced" })
        .where(and(eq(schema.itemChallenges.userId, userId), eq(schema.itemChallenges.status, "active")));
      await db.insert(schema.itemChallenges).values({
        userId: userId, itemId: args.itemId, startedAt: new Date(),
        targetDays: 30, targetWears: 7, wearsLogged: 0, streak: 0, status: "active",
      });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  logChallengeWear: defineAction({
    description: "Logs today's wear for the active 7 Ways challenge: updates progress + streak and the piece's real wear count.",
    request: z.object({ ...authFields }),
    response: z.object({
      ok: z.literal(true), wearsLogged: z.number(), streak: z.number(),
      alreadyToday: z.boolean(), completed: z.boolean(), message: z.string(),
    }),
    async handler(ctx, args): Promise<{ ok: true; wearsLogged: number; streak: number; alreadyToday: boolean; completed: boolean; message: string }> {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.itemChallenges)
        .where(and(eq(schema.itemChallenges.userId, userId), eq(schema.itemChallenges.status, "active")))
        .orderBy(desc(schema.itemChallenges.id));
      const row = rows[0];
      if (!row) return { ok: true, wearsLogged: 0, streak: 0, alreadyToday: false, completed: false, message: "No active challenge — start one first." };
      const today = new Date(now()).toISOString().slice(0, 10);
      const lastDay = row.lastWearAt ? row.lastWearAt.toISOString().slice(0, 10) : null;
      if (lastDay === today) {
        return { ok: true, wearsLogged: row.wearsLogged, streak: row.streak, alreadyToday: true, completed: false, message: "Already counted today — the challenge rewards different days, not repeat taps. Wear it again tomorrow to grow the streak." };
      }
      const yesterday = new Date(now() - DAY).toISOString().slice(0, 10);
      const streak = lastDay === yesterday ? row.streak + 1 : 1;
      const wearsLogged = row.wearsLogged + 1;
      const completed = wearsLogged >= row.targetWears;
      await db.update(schema.itemChallenges)
        .set({ wearsLogged, streak, lastWearAt: new Date(), status: completed ? "completed" : "active" })
        .where(eq(schema.itemChallenges.id, row.id));
      const itemRow = (await db.select().from(schema.wardrobeItems)
        .where(and(eq(schema.wardrobeItems.id, row.itemId), eq(schema.wardrobeItems.userId, userId))))[0];
      if (itemRow) {
        await db.update(schema.wardrobeItems)
          .set({ wornCount: itemRow.wornCount + 1, lastWornAt: new Date() })
          .where(eq(schema.wardrobeItems.id, itemRow.id));
      }
      await db.insert(schema.feedback).values({ userId: userId, kind: "worn", detail: `7 Ways challenge — wore ${itemRow?.name ?? "challenge piece"} (day ${wearsLogged} of ${row.targetWears})` });
      ctx.invalidateQueries();
      return {
        ok: true, wearsLogged, streak, alreadyToday: false, completed,
        message: completed
          ? `Challenge complete — ${row.targetWears} different days in this piece. It just went from neglected to proven.`
          : `Day ${wearsLogged} of ${row.targetWears} logged. Streak: ${streak} day${streak === 1 ? "" : "s"}.`,
      };
    },
  }),

  getDeadStock: defineAction({
    description: "Dead Stock to Cash: items unworn for 30+ days (dead stock at 90+), the ₹ locked in them, and a transparent resale estimate with a sell / donate / style-first nudge per piece.",
    request: z.object({ ...authFields }),
    response: z.object({
      items: z.array(z.object({
        item: itemSchema, daysUnworn: z.number().nullable(), tier: z.string(),
        lockedValue: z.number(), resaleEstimate: z.number(), resalePct: z.number(),
        action: z.string(), reason: z.string(),
      })),
      totalLocked: z.number(), totalResale: z.number(),
      deadCount: z.number(), staleCount: z.number(), neverWornCount: z.number(),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const flagged = items
        .filter((i) => i.wornCount === 0 || (i.daysSinceWorn ?? 0) >= 30)
        .map((i) => {
          const never = i.wornCount === 0;
          const days = never ? null : i.daysSinceWorn;
          const tier = never || (days ?? 0) >= 90 ? "Dead stock" : (days ?? 0) >= 45 ? "Going stale" : "Sleeping";
          const { resale, pct } = resaleEstimate(i);
          const action = resale >= 1500 ? "Sell" : resale < 600 ? "Donate" : i.outfitCount >= 6 ? "Style it first" : "Sell";
          const reason = never
            ? `Never worn — its full ${`₹${i.price.toLocaleString("en-IN")}`} is still locked in the tag. One wear changes everything; reselling now recovers the most.`
            : action === "Sell"
              ? `Unworn for ${days} days and still worth an estimated ${`₹${resale.toLocaleString("en-IN")}`} second-hand (${pct}% of what you paid). List it while the style is current.`
              : action === "Donate"
                ? `Unworn for ${days} days with a low resale value (~${`₹${resale.toLocaleString("en-IN")}`}). Donating frees space and the piece actually gets worn — by someone.`
                : `Unworn for ${days} days, but it pairs into ${i.outfitCount} outfits you already own. Give it one styled week (try 7 Ways) before deciding.`;
          return { item: i, daysUnworn: days, tier, lockedValue: i.price, resaleEstimate: resale, resalePct: pct, action, reason };
        })
        .sort((a, b) => b.lockedValue - a.lockedValue);
      return {
        items: flagged,
        totalLocked: flagged.reduce((a, x) => a + x.lockedValue, 0),
        totalResale: flagged.reduce((a, x) => a + x.resaleEstimate, 0),
        deadCount: flagged.filter((x) => x.tier === "Dead stock").length,
        staleCount: flagged.filter((x) => x.tier !== "Dead stock").length,
        neverWornCount: flagged.filter((x) => x.item.wornCount === 0).length,
      };
    },
  }),

  getTomorrowPlan: defineAction({
    description: "Tomorrow, Laid Out: returns tomorrow's demo weather and the plan the user laid out for tomorrow (if any), with its outfit resolved from the wardrobe.",
    request: z.object({ ...authFields }),
    response: z.object({
      date: z.string(),
      weather: z.object({ temp: z.number(), condition: z.string(), advice: z.string() }),
      plan: z.object({ occasion: z.string(), note: z.string(), outfit: outfitSchema }).nullable(),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const w = tomorrowWeather();
      const date = tomorrowDateStr();
      const rows = await db.select().from(schema.tomorrowPlans)
        .where(and(eq(schema.tomorrowPlans.userId, userId), eq(schema.tomorrowPlans.planDate, date)))
        .orderBy(desc(schema.tomorrowPlans.id));
      const row = rows[0];
      if (!row) return { date, weather: { temp: w.temp, condition: w.condition, advice: w.advice }, plan: null };
      const items = await loadItems(ctx, userId);
      const byId = new Map(items.map((i) => [i.id, i]));
      const chosen = parseItemIds(row.itemIds).map((id) => byId.get(id)).filter((i): i is ItemOut => Boolean(i));
      return {
        date,
        weather: { temp: w.temp, condition: w.condition, advice: w.advice },
        plan: {
          occasion: row.occasion, note: row.note,
          outfit: scoreOutfitItems(chosen, row.occasion || "Casual", w.engine, "Smart Casual"),
        },
      };
    },
  }),

  setTomorrowPlan: defineAction({
    description: "Tomorrow, Laid Out: picks tonight, from the wardrobe + tomorrow's weather + chosen occasion, the outfit for tomorrow and saves it as tomorrow's plan.",
    request: z.object({
      ...authFields,
      occasion: z.string().min(1).max(30),
      style: z.string().min(1).max(30).default("Smart Casual"),
    }),
    response: z.object({
      date: z.string(),
      weather: z.object({ temp: z.number(), condition: z.string(), advice: z.string() }),
      plan: z.object({ occasion: z.string(), note: z.string(), outfit: outfitSchema }),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const items = await loadItems(ctx, userId);
      const w = tomorrowWeather();
      const date = tomorrowDateStr();
      const outfit = buildOutfit(items, args.occasion, w.engine, args.style, Math.floor(now() / DAY) % 97);
      const note = outfit.items.length
        ? `${w.advice} Laid out tonight so tomorrow starts dressed: ${outfit.items.map((i) => i.name.toLowerCase()).join(" + ")}.`
        : "Add a few core pieces to your wardrobe and WearWise can lay tomorrow out for you.";
      await db.delete(schema.tomorrowPlans)
        .where(and(eq(schema.tomorrowPlans.userId, userId), eq(schema.tomorrowPlans.planDate, date)));
      await db.insert(schema.tomorrowPlans).values({
        userId: userId, planDate: date, occasion: args.occasion,
        weatherLabel: `${w.temp}°C · ${w.condition}`,
        itemIds: JSON.stringify(outfit.items.map((i) => i.id)), note,
      });
      ctx.invalidateQueries();
      return { date, weather: { temp: w.temp, condition: w.condition, advice: w.advice }, plan: { occasion: args.occasion, note, outfit } };
    },
  }),

  getColourSeason: defineAction({
    description: "Your Colour Season: derives the user's personal colour season (Spring/Summer/Autumn/Winter), palette and colours to avoid from the colours they actually own and wear.",
    request: z.object({ ...authFields }),
    response: z.object({
      season: z.string(), tagline: z.string(), undertone: z.string(), depth: z.string(), confidence: z.number(),
      palette: z.array(z.object({ name: z.string(), hex: z.string(), owned: z.boolean(), note: z.string() })),
      avoid: z.array(z.object({ name: z.string(), hex: z.string(), owned: z.boolean(), reason: z.string() })),
      ownedColors: z.array(z.object({ name: z.string(), hex: z.string(), count: z.number(), wears: z.number() })),
      guidance: z.array(z.string()),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const seasonScores: Record<string, number> = { Spring: 0, Summer: 0, Autumn: 0, Winter: 0 };
      let warmW = 0; let coolW = 0; let lightW = 0; let deepW = 0; let totalW = 0;
      const colorMap = new Map<string, { hex: string; count: number; wears: number }>();
      for (const i of items) {
        const w = i.wornCount + 2 + (i.favorite ? 3 : 0);
        totalW += w;
        const cur = colorMap.get(i.color) ?? { hex: i.colorHex, count: 0, wears: 0 };
        cur.count += 1; cur.wears += i.wornCount;
        colorMap.set(i.color, cur);
        const p = COLOR_PROFILE[i.color.toLowerCase()];
        if (!p) continue;
        for (const s of p.seasons) seasonScores[s] = (seasonScores[s] ?? 0) + w / p.seasons.length;
        if (p.undertone === "warm") warmW += w; else if (p.undertone === "cool") coolW += w;
        if (p.depth === "light") lightW += w; else deepW += w;
      }
      const season = Object.entries(seasonScores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Autumn";
      const topScore = seasonScores[season] ?? 0;
      const confidence = items.length === 0 ? 0 : Math.min(96, Math.round(38 + (totalW ? (topScore / totalW) * 62 : 0) + Math.min(12, items.length)));
      /* Undertone/depth are the winning season's canonical traits — the
         season itself was scored from the wardrobe's measured warm/cool
         and light/deep weights (kept in warmW/coolW/lightW/deepW for the
         guidance line), so the three labels always agree. */
      void warmW; void coolW; void lightW; void deepW;
      const SEASON_TRAITS: Record<string, { undertone: string; depth: string }> = {
        Spring: { undertone: "Warm", depth: "Light" }, Summer: { undertone: "Cool", depth: "Light" },
        Autumn: { undertone: "Warm", depth: "Deep" }, Winter: { undertone: "Cool", depth: "Deep" },
      };
      const undertone = SEASON_TRAITS[season]?.undertone ?? "Neutral";
      const depth = SEASON_TRAITS[season]?.depth ?? "Deep";
      const taglines: Record<string, string> = {
        Spring: "Warm, light and clear — your wardrobe glows in fresh, sunlit colour.",
        Summer: "Cool, light and soft — your wardrobe lives in calm, muted tones.",
        Autumn: "Warm, deep and earthy — your wardrobe is built on rich, grounded colour.",
        Winter: "Cool, deep and high-contrast — your wardrobe sharpens in bold, clear colour.",
      };
      const ownedColors = [...colorMap.entries()]
        .map(([name, v]) => ({ name, hex: v.hex, count: v.count, wears: v.wears }))
        .sort((a, b) => b.wears - a.wears);
      /* Palette: the season colours the user already owns and wears
         most, then the season's signature colours they don't own yet. */
      const inSeason = ownedColors.filter((c) => COLOR_PROFILE[c.name.toLowerCase()]?.seasons.includes(season));
      const palette = [
        ...inSeason.slice(0, 5).map((c) => ({ name: c.name, hex: c.hex, owned: true, note: `You own ${c.count} piece${c.count === 1 ? "" : "s"} · worn ${c.wears} times — a proven ${season} colour for you.` })),
        ...(SEASON_SIGNATURES[season] ?? []).filter((s) => !colorMap.has(s.name)).slice(0, Math.max(0, 5 - inSeason.length)).map((s) => ({ name: s.name, hex: s.hex, owned: false, note: `A ${season} signature you don't own yet — the safest new colour to try next.` })),
      ];
      /* Avoid: colours the user owns but rarely wears whose undertone
         fights the season (evidence from their own rotation), plus the
         season's classic clashes they don't own. */
      const clashingOwned = ownedColors
        .filter((c) => {
          const p = COLOR_PROFILE[c.name.toLowerCase()];
          if (!p || p.seasons.includes(season)) return false;
          const avgWears = c.count ? c.wears / c.count : 0;
          return avgWears < 12;
        })
        .slice(0, 2)
        .map((c) => ({ name: c.name, hex: c.hex, owned: true, reason: `You own it but wear it least (${c.wears} wears across ${c.count} piece${c.count === 1 ? "" : "s"}) — its undertone fights your ${season} palette, and your rotation already knows it.` }));
      const avoid = [
        ...clashingOwned,
        ...(SEASON_AVOID[season] ?? []).filter((a) => !colorMap.has(a.name)).map((a) => ({ name: a.name, hex: a.hex, owned: false, reason: a.reason })),
      ].slice(0, 4);
      const guidance = [
        `Your undertone reads ${undertone.toLowerCase()} and your depth ${depth.toLowerCase()} — that combination is the ${season} palette, derived from ${items.length} pieces and ${items.reduce((a, i) => a + i.wornCount, 0)} recorded wears.`,
        inSeason[0] ? `${inSeason[0].name} is your power colour — it's your most-worn in-season tone. Build interview and date outfits around it.` : "Add one in-season colour and watch how many existing outfits it unlocks.",
        "When you shop, run candidates through Buy-or-Skip: in-season colours will keep compounding outfits; clashing ones become dead stock.",
      ];
      return { season, tagline: taglines[season] ?? "", undertone, depth, confidence, palette, avoid, ownedColors, guidance };
    },
  }),

  askWearWise: defineAction({
    description: "Ask WearWise command center: answers natural questions (what to wear, packing, gaps, duplicates, buying) from the user's real wardrobe data.",
    request: z.object({ ...authFields, question: z.string().min(1).max(300), seed: z.number().int().min(0).default(0) }),
    response: z.object({ answer: z.string(), outfit: outfitSchema.nullable(), goto: z.string().nullable() }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const q = args.question.toLowerCase();
      if (q.includes("repeat") || q.includes("wore this") || q.includes("seen this") || q.includes("same people") || q.includes("same outfit")) {
        return {
          answer: "That's Repeat Radar's job — it remembers what you wore, on which occasion, and who saw it, and warns you before the same crowd sees the same look inside 30 days. Open Unique Edge to check a planned outfit against an audience, or log today's wear.",
          outfit: null, goto: "edge",
        };
      }
      if (q.includes("dead stock") || q.includes("sell") || q.includes("donate") || q.includes("unworn") || q.includes("locked")) {
        const flagged = items.filter((i) => i.wornCount === 0 || (i.daysSinceWorn ?? 0) >= 30);
        const locked = flagged.reduce((a, i) => a + i.price, 0);
        return {
          answer: flagged.length
            ? `You have ${flagged.length} pieces unworn for 30+ days with ₹${locked.toLocaleString("en-IN")} locked in them. Dead Stock to Cash (in Unique Edge) values each one, estimates its resale, and nudges sell, donate, or style-it-first.`
            : "Nothing is sitting unworn for 30+ days — no dead stock right now. Your rotation is doing its job.",
          outfit: null, goto: "edge",
        };
      }
      if (q.includes("colour season") || q.includes("color season") || q.includes("my season") || q.includes("colours suit") || q.includes("colors suit") || q.includes("colour palette") || q.includes("color palette")) {
        return {
          answer: "Your Colour Season works your personal palette out from the colours you actually own and wear — plus the ones your rotation quietly avoids. It's in Unique Edge, next to your Style DNA.",
          outfit: null, goto: "edge",
        };
      }
      if (q.includes("roi") || q.includes("wardrobe roi") || q.includes("most valuable") || q.includes("best value item") || q.includes("value will") && q.includes("add")) {
        const ranked = items.map((i) => roiForItem(i, items)).sort((a, b) => b.roiScore - a.roiScore);
        const best = ranked[0];
        return {
          answer: best
            ? `Wardrobe ROI ranks your ${best.name.toLowerCase()} highest at ${best.roiScore}/100 — it pairs with ${best.compatibleItems} pieces across ${best.compatibleOccasions} occasions at ₹${best.costPerWear.toLocaleString("en-IN")} per wear. Open the Intelligence hub for the full ROI league table, item by item.`
            : "Add a few pieces first — Wardrobe ROI needs a wardrobe to value.",
          outfit: null, goto: "intelligence",
        };
      }
      if (q.includes("health") || q.includes("how healthy") || q.includes("wardrobe score")) {
        return {
          answer: "Your Wardrobe Health score — versatility, usage, colour balance, occasion coverage, duplication, cost efficiency and outfit potential — lives in the Intelligence hub, with the full breakdown of how it's calculated.",
          outfit: null, goto: "intelligence",
        };
      }
      if (q.includes("evolution") || q.includes("style changed") || q.includes("style over time")) {
        return {
          answer: "Style Evolution tracks how your taste shifts month by month, from your actual ratings — it's in the Intelligence hub, next to your AI Memory.",
          outfit: null, goto: "intelligence",
        };
      }
      if (q.includes("confidence") || q.includes("how sure") || q.includes("preferences") || q.includes("what have you learned") || q.includes("ai memory")) {
        return {
          answer: "Everything WearWise has learned about your taste — preferred colours, fits, styles, and the weights behind them — is in the Intelligence hub under AI Memory & Preferences. Every outfit also ships with a confidence score based on how much data backs it.",
          outfit: null, goto: "intelligence",
        };
      }
      if (q.includes("tomorrow")) {
        return {
          answer: "Tomorrow, Laid Out picks tomorrow's outfit tonight — from tomorrow's weather and your occasion — and saves it so you wake up to it ready. Set it up in Unique Edge.",
          outfit: null, goto: "edge",
        };
      }
      if (q.includes("7 ways") || q.includes("seven ways") || q.includes("neglected") || q.includes("challenge")) {
        const stale = [...items].sort((a, b) => (b.daysSinceWorn ?? 0) - (a.daysSinceWorn ?? 0))[0];
        return {
          answer: stale
            ? `Your most neglected piece is your ${stale.name.toLowerCase()} — unworn for ${stale.daysSinceWorn ?? 0} days. One Item, 7 Ways (in Unique Edge) builds seven outfits around it and starts a 30-day challenge to actually wear it.`
            : "Add a few pieces first — One Item, 7 Ways needs a wardrobe to rescue pieces from.",
          outfit: null, goto: "edge",
        };
      }
      if (q.includes("pack") || q.includes("goa") || q.includes("trip")) {
        const dest = q.includes("goa") ? "Goa" : "your trip";
        return {
          answer: `For ${dest}, pack light and layered: your most-worn tees, one smart shirt, two bottoms and your most versatile sneakers cover beach, casual and party without a second bag. Open Pack Smart and I'll build the exact list from your wardrobe.`,
          outfit: null, goto: "pack",
        };
      }
      if (q.includes("missing") || q.includes("gap") || q.includes("need") && q.includes("wardrobe")) {
        const gap = computeGaps(items)[0];
        return {
          answer: gap
            ? `Your biggest gap: ${gap.title.toLowerCase()}. ${gap.reason}`
            : "Your wardrobe covers the essentials well — the next unlock is a statement piece, not another basic.",
          outfit: null, goto: "analytics",
        };
      }
      if (q.includes("another black") || q.includes("black shirt") || q.includes("duplicate") || q.includes("already own")) {
        const blackTops = items.filter((i) => i.slot === "top" && i.color.toLowerCase() === "black");
        return {
          answer: blackTops.length
            ? `You already own ${blackTops.length} black top${blackTops.length > 1 ? "s" : ""} — including your ${blackTops[0]!.name.toLowerCase()}. Another one adds almost no new outfit. Put the money toward a gap instead; run it through Buy-or-Skip first if you're tempted.`
            : "Surprisingly, no — you don't own a black top right now. That one would genuinely be new.",
          outfit: null, goto: "buy",
        };
      }
      if (q.includes("buy") || q.includes("worth")) {
        return {
          answer: "Paste it into Buy-or-Skip and I'll score it against everything you own — duplicates, occasions, combinations and projected cost-per-wear — before you spend a rupee.",
          outfit: null, goto: "buy",
        };
      }
      if (q.includes("style my") || q.includes("how can i style") || q.includes("pair")) {
        const target = items.find((i) => q.includes(i.color.toLowerCase()) && (q.includes("trouser") || q.includes("chino") || q.includes("jean") || q.includes("pant")))
          ?? items.filter((i) => i.slot === "bottom").sort((a, b) => b.wornCount - a.wornCount)[0];
        if (target) {
          const outfit = buildAnchoredOutfit(items, target, "Casual", "Warm", "Smart Casual");
          return {
            answer: `Your ${target.name.toLowerCase()} is one of your most flexible pieces. Start here — and the Occasion Transformer in the AI Stylist restyles it five ways.`,
            outfit, goto: "stylist",
          };
        }
      }
      const outfit = buildOutfit(items, q.includes("interview") ? "Interview" : q.includes("date") ? "Date" : q.includes("party") ? "Party" : q.includes("wedding") || q.includes("festive") ? "Festive" : "Casual", "Warm", "Smart Casual", args.seed);
      return {
        answer: outfit.items.length
          ? `From your wardrobe: ${outfit.items.map((i) => i.name.toLowerCase()).join(" + ")}. That's a ${outfit.matchScore}% match — ${outfit.explanation}`
          : "Add a few core pieces to your wardrobe and I can answer that properly.",
        outfit: outfit.items.length ? outfit : null, goto: "stylist",
      };
    },
  }),
  /* ---------------- Intelligence Layer actions (§1–§26) ------------ */

  getIntelligence: defineAction({
    description: "Intelligence Layer hub: returns the unified context, style-engine profile, preference weights, AI memory, confidence, extended wardrobe health, style evolution, AI evaluation, user analytics and smart notifications — all computed from the user's real rows.",
    request: z.object({ ...authFields }),
    response: z.object({
      context: z.object({
        itemCount: z.number(), feedbackCount: z.number(), favoriteCount: z.number(),
        slotsCovered: z.array(z.string()), topColors: z.array(z.string()),
      }),
      styleProfile: z.object({
        archetype: z.string(), preferredColors: z.array(z.string()), avoidedColors: z.array(z.string()),
        preferredFits: z.array(z.string()), preferredPatterns: z.array(z.string()),
        formalityPreference: z.string(), favoriteCategories: z.array(z.string()),
        preferredFootwear: z.string(), layeringPreference: z.string(),
        traditionalShare: z.number(), westernShare: z.number(), occasionPreferences: z.array(z.string()),
      }),
      preferences: z.object({
        preferredColors: z.record(z.string(), z.number()), avoidedColors: z.record(z.string(), z.number()),
        preferredStyles: z.record(z.string(), z.number()), avoidedStyles: z.record(z.string(), z.number()),
        preferredFits: z.record(z.string(), z.number()), signalCount: z.number(),
      }),
      memory: z.object({
        favoriteColors: z.array(z.string()), avoidedColors: z.array(z.string()),
        favoriteFits: z.array(z.string()), favoriteStyles: z.array(z.string()),
        favoriteOccasions: z.array(z.string()), preferredFootwear: z.string(),
        preferredBrands: z.array(z.string()), budgetRange: z.string(),
        traditionalWestern: z.string(), layeringPreference: z.string(),
      }),
      confidence: z.number(),
      health: z.object({
        score: z.number(),
        dimensions: z.array(z.object({ label: z.string(), score: z.number() })),
        explanation: z.string(),
      }),
      evolution: z.array(z.object({ month: z.string(), dominantStyle: z.string(), signals: z.number() })),
      evaluation: z.object({
        totalSignals: z.number(), accepted: z.number(), rejected: z.number(),
        loveRate: z.number().nullable(), dislikeRate: z.number().nullable(),
        saveRate: z.number().nullable(), wearRate: z.number().nullable(),
        buyAnalyses: z.number(), outfitsSaved: z.number(), packingPlans: z.number(),
        topFeature: z.string(), weakestFeature: z.string(),
      }),
      usageCounts: z.array(z.object({ label: z.string(), count: z.number() })),
      userAnalytics: z.object({
        wardrobeSize: z.number(), mostWornCategory: z.string(), leastWornCategory: z.string(),
        favoriteColor: z.string(), mostUsedPiece: z.string(), averageCostPerWear: z.number(),
        unusedItems: z.number(), totalWardrobeValue: z.number(),
      }),
      notifications: z.array(z.object({ id: z.string(), icon: z.string(), title: z.string(), body: z.string(), goto: z.string() })),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const items = await loadItems(ctx, userId);
      const fbRows = await db.select().from(schema.feedback).where(eq(schema.feedback.userId, userId)).orderBy(desc(schema.feedback.createdAt));
      const fb: FbRow[] = fbRows.map((r) => ({ kind: r.kind, detail: r.detail, createdAt: r.createdAt }));
      const saved = await db.select().from(schema.savedOutfits).where(eq(schema.savedOutfits.userId, userId));
      const analyses = await db.select().from(schema.buyAnalyses).where(eq(schema.buyAnalyses.userId, userId));
      const total = items.length;
      const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

      /* --- Preference Engine + Style Engine + AI Memory --- */
      const preferences = computePreferenceWeights(items, fb);
      const wearW = (i: ItemOut) => i.wornCount + 2;
      const totalWear = items.reduce((a, i) => a + wearW(i), 0) || 1;
      const topBy = (key: (i: ItemOut) => string, n: number) => {
        const m = new Map<string, number>();
        for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + wearW(i));
        return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
      };
      const ethnicWear = items.filter((i) => i.slot === "ethnic").reduce((a, i) => a + wearW(i), 0);
      const traditionalShare = Math.round((ethnicWear / totalWear) * 100);
      const avgFormality = items.reduce((a, i) => a + i.formality * wearW(i), 0) / totalWear;
      const layers = items.filter((i) => i.slot === "outerwear").length;
      const layeringPreference = layers >= 3 ? "Layers often — jackets and overshirts are a real part of the rotation" : layers > 0 ? "Occasional layering" : "Rarely layers — no outerwear in rotation yet";
      const bestShoes = [...items].filter((i) => i.slot === "shoes").sort((a, b) => b.wornCount - a.wornCount)[0];
      const styleProfile = {
        archetype: topBy((i) => i.style, 1)[0] ?? "Casual",
        preferredColors: topBy((i) => i.color, 4),
        avoidedColors: Object.keys(preferences.avoidedColors),
        preferredFits: topBy((i) => i.fit, 2),
        preferredPatterns: topBy((i) => i.pattern, 2),
        formalityPreference: `Averages ${avgFormality.toFixed(1)} of 5 — ${avgFormality >= 3.4 ? "leans smart/formal" : avgFormality <= 2.2 ? "leans relaxed/casual" : "sits in the smart-casual middle"}`,
        favoriteCategories: topBy((i) => i.category, 3),
        preferredFootwear: bestShoes ? `${bestShoes.category} (${bestShoes.color})` : "Not enough footwear data yet",
        layeringPreference,
        traditionalShare, westernShare: 100 - traditionalShare,
        occasionPreferences: topBy((i) => i.occasions[0] ?? "Casual", 4),
      };
      const brandCounts = new Map<string, number>();
      for (const i of items) if (i.brand) brandCounts.set(i.brand, (brandCounts.get(i.brand) ?? 0) + i.wornCount + 1);
      const memory = {
        favoriteColors: styleProfile.preferredColors,
        avoidedColors: styleProfile.avoidedColors,
        favoriteFits: styleProfile.preferredFits,
        favoriteStyles: Object.keys(preferences.preferredStyles).slice(0, 3),
        favoriteOccasions: styleProfile.occasionPreferences,
        preferredFootwear: styleProfile.preferredFootwear,
        preferredBrands: [...brandCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b]) => b),
        budgetRange: analyses.length
          ? `Recent analyses average ₹${Math.round(analyses.reduce((a, x) => a + x.price, 0) / analyses.length).toLocaleString("en-IN")} per piece`
          : "Not set — no purchases analysed yet",
        traditionalWestern: traditionalShare >= 40 ? "Traditional-leaning — ethnic wear is a core part of the rotation" : traditionalShare >= 12 ? "Mostly western, traditional for festive and family occasions" : "Mostly western",
        layeringPreference,
      };

      /* --- Wardrobe Health, extended (§15): nine dimensions --- */
      const slots = new Set(items.map((i) => i.slot));
      const frequent = items.filter((i) => i.wornCount >= 15).length;
      const rare = items.filter((i) => i.wornCount < 5).length;
      const versatility = Math.max(20, Math.min(97, Math.round(30 + slots.size * 9 + Math.min(20, total))));
      const usageScore = Math.max(15, Math.min(97, Math.round(100 - pct(rare) * 0.9 - (100 - pct(frequent)) * 0.15)));
      const neutralShare = total ? items.filter((i) => NEUTRALS.has(i.color.toLowerCase())).length / total : 0;
      const colorBalance = Math.max(25, Math.min(96, Math.round(96 - Math.abs(neutralShare - 0.68) * 130)));
      const coveredOcc = Object.entries(OCCASION_FORMALITY).filter(([, [lo, hi]]) => items.some((i) => i.formality >= lo && i.formality <= hi)).length;
      const occasionCoverage = Math.max(20, Math.min(97, Math.round((coveredOcc / Object.keys(OCCASION_FORMALITY).length) * 100)));
      const dupeGroups = new Map<string, number>();
      for (const i of items) { const k = `${i.slot}|${i.color.toLowerCase()}`; dupeGroups.set(k, (dupeGroups.get(k) ?? 0) + 1); }
      const dupeExcess = [...dupeGroups.values()].reduce((a, n) => a + Math.max(0, n - 2), 0);
      const duplication = Math.max(22, Math.min(96, 94 - dupeExcess * 9));
      const catCounts = new Map<string, number>();
      for (const i of items) catCounts.set(i.category, (catCounts.get(i.category) ?? 0) + 1);
      const categoryBalance = Math.max(20, Math.min(97, Math.round((Math.min(catCounts.size, 10) / 10) * 60 + (slots.size / 6) * 40)));
      const unusedScore = Math.max(15, Math.min(97, 100 - pct(rare)));
      /* Outfit potential = pairing coverage: the average piece's real
         pairings (outfitCount, now counted from the rows) as a share of
         the other pieces it could possibly pair with. Audit fix: the old
         formula (avg × 6) was an arbitrary scale over an inflated count. */
      const outfitPotential = total > 1
        ? Math.max(20, Math.min(97, Math.round((items.reduce((a, i) => a + i.outfitCount, 0) / total) / (total - 1) * 100)))
        : 20;
      const avgCpw = total ? Math.round(items.reduce((a, i) => a + i.costPerWear, 0) / total) : 0;
      const costEfficiency = Math.max(20, Math.min(97, Math.round(100 - Math.min(60, avgCpw / 12))));
      const dimensions = [
        { label: "Versatility", score: versatility }, { label: "Usage", score: usageScore },
        { label: "Category balance", score: categoryBalance }, { label: "Occasion coverage", score: occasionCoverage },
        { label: "Duplication control", score: duplication }, { label: "Unused items", score: unusedScore },
        { label: "Color balance", score: colorBalance }, { label: "Outfit potential", score: outfitPotential },
        { label: "Cost efficiency", score: costEfficiency },
      ];
      const healthScore = Math.round(dimensions.reduce((a, d) => a + d.score, 0) / dimensions.length);
      const weakestDim = [...dimensions].sort((a, b) => a.score - b.score)[0];
      const health = {
        score: Math.max(15, Math.min(97, healthScore)),
        dimensions,
        explanation: `Averaged from nine dimensions of your actual wardrobe. Weakest right now: ${weakestDim?.label ?? "—"} (${weakestDim?.score ?? 0}/100) — that's where one smart change moves the score most.`,
      };

      /* --- Style Evolution (§26): per-month dominant rated style --- */
      const byMonth = new Map<string, { styles: Map<string, number>; signals: number; sort: number }>();
      for (const f of fb) {
        const key = f.createdAt.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
        const entry = byMonth.get(key) ?? { styles: new Map<string, number>(), signals: 0, sort: f.createdAt.getTime() };
        entry.signals += 1;
        if (f.kind === "love" || f.kind === "liked" || f.kind === "good") {
          const s = styleFromFeedbackDetail(f.detail);
          if (s) entry.styles.set(s, (entry.styles.get(s) ?? 0) + 1);
        }
        byMonth.set(key, entry);
      }
      const evolution = [...byMonth.entries()]
        .map(([month, e]) => ({
          month,
          dominantStyle: [...e.styles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Exploring",
          signals: e.signals, sort: e.sort,
        }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ month, dominantStyle, signals }) => ({ month, dominantStyle, signals }));

      /* --- AI Evaluation (§16) + usage analytics (§17) --- */
      const rated = fb.filter((f) => ["love", "liked", "good", "unsure", "not"].includes(f.kind));
      const loves = fb.filter((f) => f.kind === "love").length;
      const nots = fb.filter((f) => f.kind === "not").length;
      const savedSignals = fb.filter((f) => f.kind === "saved").length;
      const wornSignals = fb.filter((f) => f.kind === "worn").length;
      const rate = (n: number) => (rated.length ? Math.round((n / rated.length) * 100) : null);
      const featureCounts: Array<[string, number]> = [
        ["Buy / Skip", analyses.length], ["AI Stylist (saved outfits)", saved.length],
        ["Outfit feedback", rated.length], ["Wear tracking", wornSignals],
      ];
      const sortedFeatures = [...featureCounts].sort((a, b) => b[1] - a[1]);
      const evaluation = {
        totalSignals: fb.length,
        accepted: fb.filter((f) => ["love", "liked", "good"].includes(f.kind)).length,
        rejected: nots,
        loveRate: rate(loves), dislikeRate: rate(nots),
        saveRate: fb.length ? Math.round((savedSignals / fb.length) * 100) : null,
        wearRate: fb.length ? Math.round((wornSignals / fb.length) * 100) : null,
        buyAnalyses: analyses.length, outfitsSaved: saved.length, packingPlans: 0,
        topFeature: sortedFeatures[0] && sortedFeatures[0][1] > 0 ? sortedFeatures[0][0] : "Not enough usage yet",
        weakestFeature: sortedFeatures[sortedFeatures.length - 1]?.[0] ?? "—",
      };
      const usageCounts = [
        { label: "Outfits saved", count: saved.length },
        { label: "Feedback signals", count: fb.length },
        { label: "Buy/Skip analyses", count: analyses.length },
        { label: "Wears logged", count: wornSignals },
      ];

      /* --- User analytics (§18) --- */
      const catWear = new Map<string, number>();
      for (const i of items) catWear.set(i.category, (catWear.get(i.category) ?? 0) + i.wornCount);
      const catSorted = [...catWear.entries()].sort((a, b) => b[1] - a[1]);
      const colorWear = new Map<string, number>();
      for (const i of items) colorWear.set(i.color, (colorWear.get(i.color) ?? 0) + i.wornCount + 1);
      const userAnalytics = {
        wardrobeSize: total,
        mostWornCategory: catSorted[0]?.[0] ?? "—",
        leastWornCategory: catSorted.length ? catSorted[catSorted.length - 1]![0] : "—",
        favoriteColor: [...colorWear.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—",
        mostUsedPiece: [...items].sort((a, b) => b.wornCount - a.wornCount)[0]?.name ?? "—",
        averageCostPerWear: avgCpw,
        unusedItems: rare,
        totalWardrobeValue: items.reduce((a, i) => a + i.price, 0),
      };

      /* --- Smart notifications (§25): derived, capped, useful --- */
      const notifications: Array<{ id: string; icon: string; title: string; body: string; goto: string }> = [];
      const stale = [...items].filter((i) => (i.daysSinceWorn ?? 0) >= 30).sort((a, b) => (b.daysSinceWorn ?? 0) - (a.daysSinceWorn ?? 0))[0];
      if (stale) notifications.push({ id: "unused", icon: "👕", title: "Unused wardrobe", body: `Your ${stale.name.toLowerCase()} has been unworn for ${stale.daysSinceWorn} days — style it this week or let Dead Stock value it.`, goto: "edge" });
      const versatile = [...items].sort((a, b) => b.outfitCount - a.outfitCount)[0];
      if (versatile) notifications.push({ id: "versatile", icon: "🔥", title: "Most versatile item", body: `Your ${versatile.name.toLowerCase()} anchors ${versatile.outfitCount} outfit pairings — the hardest-working piece you own.`, goto: "intelligence" });
      const topGap = computeGaps(items)[0];
      if (topGap) notifications.push({ id: "gap", icon: "💡", title: "Wardrobe gap", body: `${topGap.title}: ${topGap.reason}`, goto: "analytics" });
      const heavyTopColor = [...dupeGroups.entries()].filter(([k]) => k.startsWith("top|")).sort((a, b) => b[1] - a[1])[0];
      if (heavyTopColor && heavyTopColor[1] >= 3) notifications.push({ id: "buy", icon: "🛍️", title: "Before you buy", body: `You already own ${heavyTopColor[1]} ${heavyTopColor[0].split("|")[1]} tops — run the next one through Buy-or-Skip before spending.`, goto: "buy" });
      notifications.push({ id: "today", icon: "☀️", title: "Today's style", body: "Tomorrow's outfit can be laid out tonight — weather-checked and occasion-ready in Unique Edge.", goto: "edge" });

      return {
        context: {
          itemCount: total, feedbackCount: fb.length,
          favoriteCount: items.filter((i) => i.favorite).length,
          slotsCovered: [...slots], topColors: styleProfile.preferredColors,
        },
        styleProfile, preferences, memory,
        confidence: confidenceFor(total, fb.length),
        health, evolution, evaluation, usageCounts, userAnalytics,
        notifications: notifications.slice(0, 4),
      };
    },
  }),

  getWardrobeROI: defineAction({
    description: "Wardrobe ROI: ranks every owned piece by the value it adds — potential outfits, compatible items/occasions, versatility, wear frequency, duplicate risk and cost-per-wear — plus the wardrobe average.",
    request: z.object({ ...authFields }),
    response: z.object({
      items: z.array(z.object({
        itemId: z.number(), name: z.string(), brand: z.string(), roiScore: z.number(),
        potentialOutfits: z.number(), compatibleItems: z.number(), compatibleOccasions: z.number(),
        versatility: z.number(), wearFrequency: z.number(), duplicateRisk: z.number(),
        price: z.number(), costPerWear: z.number(), gapContribution: z.string(),
      })),
      averageRoi: z.number(),
      bestItemId: z.number().nullable(),
    }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const items = await loadItems(ctx, userId);
      const ranked = items.map((i) => roiForItem(i, items)).sort((a, b) => b.roiScore - a.roiScore);
      return {
        items: ranked,
        averageRoi: ranked.length ? Math.round(ranked.reduce((a, r) => a + r.roiScore, 0) / ranked.length) : 0,
        bestItemId: ranked[0]?.itemId ?? null,
      };
    },
  }),

  recordDetailedFeedback: defineAction({
    description: "Advanced feedback: stores an outfit rating WITH a reason (too formal, wrong colour, perfect…) so the Preference Engine can learn specifically, and returns what changed.",
    request: z.object({
      ...authFields,
      rating: z.enum(["love", "good", "unsure", "not"]),
      reason: z.string().max(40).default(""),
      detail: z.string().max(200).default(""),
    }),
    response: z.object({
      ok: z.literal(true), learnedNote: z.string(), feedbackCount: z.number(),
      preferenceEffect: z.string(), topPreferredStyle: z.string().nullable(), topAvoidedStyle: z.string().nullable(),
    }),
    async handler(ctx, args): Promise<{ ok: true; learnedNote: string; feedbackCount: number; preferenceEffect: string; topPreferredStyle: string | null; topAvoidedStyle: string | null }> {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const detail = `${args.detail}${args.reason ? ` · Reason: ${args.reason}` : ""}`.slice(0, 240);
      await db.insert(schema.feedback).values({ userId: userId, kind: args.rating, detail });
      const fbRows = await db.select().from(schema.feedback).where(eq(schema.feedback.userId, userId));
      const items = await loadItems(ctx, userId);
      const weights = computePreferenceWeights(items, fbRows.map((r) => ({ kind: r.kind, detail: r.detail, createdAt: r.createdAt })));
      const effects: Record<string, string> = {
        "Perfect": "This look's style and colours are weighted higher in your next recommendations.",
        "Too formal": "Formality weight drops for everyday occasions — future picks lean more relaxed.",
        "Too casual": "Formality weight rises — future picks for this occasion lean smarter.",
        "Don't like the color": "That colour's preference weight drops; it will lead fewer recommendations.",
        "Don't like the combination": "That pairing is noted — the engine avoids repeating this exact combination.",
        "Already wear this too often": "Rotation weight rises — fresher pieces surface first.",
        "Not suitable for me": "This style's avoided weight rises in your preference profile.",
        "Not comfortable": "Comfort signal stored — relaxed fits get a small preference boost.",
      };
      const preferenceEffect = effects[args.reason] ?? (args.rating === "love"
        ? "Loved looks pull their style and colours up in future recommendations."
        : args.rating === "not" ? "“Not my style” pushes this style down in future recommendations."
          : "Signal stored — it shapes your preference weights alongside your other feedback.");
      const topPreferredStyle = Object.keys(weights.preferredStyles)[0] ?? null;
      const topAvoidedStyle = Object.keys(weights.avoidedStyles)[0] ?? null;
      ctx.invalidateQueries();
      return {
        ok: true,
        learnedNote: `Signal ${fbRows.length} stored${args.reason ? ` with reason “${args.reason}”` : ""}. ${preferenceEffect}`,
        feedbackCount: fbRows.length,
        preferenceEffect,
        topPreferredStyle, topAvoidedStyle,
      };
    },
  }),

  exportMyData: defineAction({
    description: "Data control: exports the user's wardrobe metadata, saved outfits, Buy/Skip analyses, feedback signals and Style DNA as one JSON bundle for download. Uploaded wardrobe photos are included as a photos section (item name + a link to the stored photo).",
    request: z.object({ ...authFields }),
    response: z.object({ bundle: z.string(), itemCount: z.number(), generatedAt: z.string() }),
    async handler(ctx, args) {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const items = await loadItems(ctx, userId);
      const saved = await db.select().from(schema.savedOutfits).where(eq(schema.savedOutfits.userId, userId));
      const analyses = await db.select().from(schema.buyAnalyses).where(eq(schema.buyAnalyses.userId, userId));
      const fb = await db.select().from(schema.feedback).where(eq(schema.feedback.userId, userId));
      const profileRows = await db.select().from(schema.profiles).where(eq(schema.profiles.id, userId)).limit(1);
      /* Uploaded photos are part of the user's data: each saved photo is
         listed with the piece it belongs to and a link to the stored
         image, so the export actually contains them. */
      const photoRows = await db.select({
        id: schema.wardrobeItems.id, name: schema.wardrobeItems.name, photoBlobKey: schema.wardrobeItems.photoBlobKey,
      }).from(schema.wardrobeItems).where(eq(schema.wardrobeItems.userId, userId));
      const photos: Array<{ itemId: number; itemName: string; photoUrl: string }> = [];
      for (const r of photoRows) {
        if (!r.photoBlobKey) continue;
        const url = await photoUrlFor(ctx, r.photoBlobKey);
        if (url) photos.push({ itemId: r.id, itemName: r.name, photoUrl: url });
      }
      const generatedAt = new Date().toISOString();
      const bundle = JSON.stringify({
        exportedFrom: "WearWise",
        generatedAt,
        profile: profileRows[0] ? { name: profileRows[0].name, email: profileRows[0].email } : null,
        wardrobe: items,
        photos,
        savedOutfits: saved.map((o) => ({ title: o.title, itemIds: o.itemIds, occasion: o.occasion, matchScore: o.matchScore, explanation: o.explanation, createdAt: o.createdAt.toISOString() })),
        buyAnalyses: analyses.map((a) => ({ productName: a.productName, price: a.price, mrp: a.mrp, verdict: a.verdict, score: a.score, verdictText: a.verdictText, createdAt: a.createdAt.toISOString() })),
        feedback: fb.map((f) => ({ kind: f.kind, detail: f.detail, createdAt: f.createdAt.toISOString() })),
        note: "Preferences and Style DNA are derived from this data by the Intelligence Layer — export the rows and they can be rebuilt exactly. Uploaded photos are listed under \"photos\" with a link to each stored image; Delete My Data removes the stored photos along with everything else.",
      }, null, 2);
      return { bundle, itemCount: items.length, generatedAt };
    },
  }),

  deleteMyData: defineAction({
    description: "Data control: permanently deletes the user's wardrobe-related data (wardrobe, stored uploaded photos, saved outfits, analyses, feedback, wear logs, challenges, tomorrow plans). The account profile itself is kept so the user can start fresh or re-seed the demo.",
    request: z.object({ ...authFields }),
    response: z.object({ ok: z.literal(true), deletedItems: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; deletedItems: number }> {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const before = await db.select({ id: schema.wardrobeItems.id }).from(schema.wardrobeItems).where(eq(schema.wardrobeItems.userId, userId));
      /* Stored photos are part of the user's data — they go too. */
      await deleteAllUserPhotoBlobs(ctx, userId);
      await db.delete(schema.tomorrowPlans).where(eq(schema.tomorrowPlans.userId, userId));
      await db.delete(schema.itemChallenges).where(eq(schema.itemChallenges.userId, userId));
      await db.delete(schema.wearLogs).where(eq(schema.wearLogs.userId, userId));
      await db.delete(schema.feedback).where(eq(schema.feedback.userId, userId));
      await db.delete(schema.buyAnalyses).where(eq(schema.buyAnalyses.userId, userId));
      await db.delete(schema.savedOutfits).where(eq(schema.savedOutfits.userId, userId));
      await db.delete(schema.wardrobeItems).where(eq(schema.wardrobeItems.userId, userId));
      /* Deleting your data also signs out every other session for
         this account; the current session stays so the user lands on
         a working (empty) account rather than a dead end. */
      await db.delete(schema.sessions).where(and(
        eq(schema.sessions.userId, userId),
        ne(schema.sessions.tokenHash, await sha256Hex(args.sessionToken ?? "")),
      ));
      ctx.invalidateQueries();
      return { ok: true, deletedItems: before.length };
    },
  }),

  resetDemoWardrobe: defineAction({
    description: "Demo Mode reset: clears the user's wardrobe data and re-seeds the original real branded demo wardrobe with its demo wear history, returning the demo to its initial state.",
    request: z.object({ ...authFields }),
    response: z.object({ ok: z.literal(true), count: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; count: number }> {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      await deleteAllUserPhotoBlobs(ctx, userId);
      await db.delete(schema.tomorrowPlans).where(eq(schema.tomorrowPlans.userId, userId));
      await db.delete(schema.itemChallenges).where(eq(schema.itemChallenges.userId, userId));
      await db.delete(schema.wearLogs).where(eq(schema.wearLogs.userId, userId));
      await db.delete(schema.feedback).where(eq(schema.feedback.userId, userId));
      await db.delete(schema.buyAnalyses).where(eq(schema.buyAnalyses.userId, userId));
      await db.delete(schema.savedOutfits).where(eq(schema.savedOutfits.userId, userId));
      await db.delete(schema.wardrobeItems).where(eq(schema.wardrobeItems.userId, userId));
      const t = now();
      await db.insert(schema.wardrobeItems).values(
        REAL_WARDROBE.map((d, idx) => ({
          userId: userId,
          brand: d.brand, productUrl: d.productUrl, retailer: d.retailer,
          name: d.name, category: d.category, slot: d.slot, color: d.color,
          colorHex: d.colorHex, pattern: d.pattern, material: d.material,
          style: d.style, season: d.season, formality: d.formality, price: d.price, mrp: d.mrp,
          wornCount: d.wornCount,
          lastWornAt: d.daysAgo === null ? null : new Date(t - d.daysAgo * DAY),
          favorite: d.favorite, imageKey: d.imageKey,
          createdAt: new Date(t - idx * 1000),
        })),
      );
      const seededRows = await db.select().from(schema.wardrobeItems)
        .where(eq(schema.wardrobeItems.userId, userId))
        .orderBy(desc(schema.wardrobeItems.createdAt));
      const seedId = (idx: number) => seededRows[idx]?.id;
      const demoLogs: Array<{ idx: number[]; occasion: string; audience: string; location: string; daysAgo: number }> = [
        { idx: [2, 9, 12], occasion: "College", audience: "College friends", location: "Campus", daysAgo: 3 },
        { idx: [1, 22, 11], occasion: "Placement Interview", audience: "Placement panel", location: "Placement cell", daysAgo: 5 },
        { idx: [19, 10, 14], occasion: "Casual", audience: "Close friends", location: "Neighbourhood café", daysAgo: 9 },
        { idx: [0, 9, 12], occasion: "Date", audience: "Dinner group", location: "Dinner out", daysAgo: 12 },
        { idx: [16, 11], occasion: "Festive", audience: "Family", location: "Family function", daysAgo: 20 },
      ];
      const logRows = demoLogs
        .map((l) => ({ ...l, ids: l.idx.map(seedId).filter((n): n is number => typeof n === "number") }))
        .filter((l) => l.ids.length >= 2);
      if (logRows.length) {
        await db.insert(schema.wearLogs).values(logRows.map((l) => ({
          userId: userId, itemIds: JSON.stringify(l.ids),
          occasion: l.occasion, audience: l.audience, location: l.location,
          wornAt: new Date(t - l.daysAgo * DAY),
        })));
      }
      ctx.invalidateQueries();
      return { ok: true, count: REAL_WARDROBE.length };
    },
  }),

  clearAiMemory: defineAction({
    description: "Privacy control (§13): clears ONLY the user's AI memory — every stored feedback signal (ratings, reasons, worn/saved signals) that preference weights, Style DNA's learned line, AI Memory and Style Evolution are derived from. Wardrobe, outfits and analyses are untouched; personalization relearns from future feedback.",
    request: z.object({ ...authFields }),
    response: z.object({ ok: z.literal(true), cleared: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; cleared: number }> {
      const userId = await requireAuth(ctx, args);
      const db = ctx.db<typeof schema>();
      const before = await db.select({ id: schema.feedback.id }).from(schema.feedback).where(eq(schema.feedback.userId, userId));
      await db.delete(schema.feedback).where(eq(schema.feedback.userId, userId));
      ctx.invalidateQueries();
      return { ok: true, cleared: before.length };
    },
  }),
} satisfies ActionsModule;
