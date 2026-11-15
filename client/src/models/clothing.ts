/* ClothingItem — the central wardrobe model (brief §2, §3).
   Every feature (stylist, generator, Snap & Style, Buy/Skip, duplicates,
   gaps, Smart Shop, Style DNA, analytics, packing, Ask WearWise) reads
   this one shape, adapted once from the server's item contract in
   services/mappers.ts. Outfits reference these by `id` only. */

export type ClothingCategory =
  | "Tops" | "Bottoms" | "Shoes" | "Outerwear" | "Accessories" | "Ethnic Wear";

/** Fine-grained garment type (the server's `category` column). */
export type ClothingSubcategory =
  | "T-Shirt" | "Shirt" | "Polo" | "Hoodie" | "Jeans" | "Trousers" | "Shorts"
  | "Sneakers" | "Loafers" | "Jacket" | "Overshirt" | "Kurta" | "Nehru Jacket"
  | "Sherwani" | "Saree" | "Lehenga" | "Jutti" | "Watch" | "Belt" | "Sunglasses"
  | string;

/** Layout slot used by the outfit engine (the server's `slot` column). */
export type ClothingSlot = "top" | "bottom" | "shoes" | "outerwear" | "accessory" | "ethnic";

export const SLOT_TO_CATEGORY: Record<ClothingSlot, ClothingCategory> = {
  top: "Tops",
  bottom: "Bottoms",
  shoes: "Shoes",
  outerwear: "Outerwear",
  accessory: "Accessories",
  ethnic: "Ethnic Wear",
};

/** AI attributes for a garment (brief §3). Deterministic mock values are
    derived from the item's real fields by selectors.deriveAiAttributes —
    they are presentation-layer estimates, never stored or shown as a
    vision model's measured confidence. */
export interface ClothingAIAttributes {
  categoryConfidence: number; // 0–1
  colorConfidence: number; // 0–1
  styleConfidence: number; // 0–1
  formalityScore: number; // 0–1
  versatilityScore: number; // 0–1
  seasonSuitability: Record<string, number>; // season → 0–1
  detectedFeatures: string[];
}

export interface ClothingItem {
  id: number;
  userId: number;
  name: string;
  category: ClothingCategory;
  subcategory: ClothingSubcategory;
  /** Raw layout slot from the server — the outfit engine's grouping key. */
  slot: ClothingSlot;
  /** Owned image key (hero | overshirt | blacktee) or null → colour tile. */
  image: string | null;
  color: string;
  colorHex: string;
  secondaryColors: string[];
  pattern: string;
  material: string;
  /** Fit descriptor (Slim | Regular | Relaxed | Oversized), stored on
      the item since migration 0005; user-correctable in Add/Edit. Rows
      never edited carry the neutral "Regular" default. */
  fit: string;
  style: string[];
  season: string[];
  occasions: string[];
  formality: number; // 1 casual .. 5 formal
  brand: string;
  retailer: string;
  productUrl: string | null;
  purchasePrice: number; // ₹ actually paid
  mrp: number | null; // ₹ list price when a real one is known
  purchaseDate: string | null; // ISO instant
  timesWorn: number;
  lastWorn: string | null; // ISO instant
  favorite: boolean;
  tags: string[];
  aiAttributes: ClothingAIAttributes;
}
