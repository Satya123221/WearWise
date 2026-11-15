/* PurchaseAnalysis — the Buy-or-Skip model (brief §8). The server stores
   the verdict + overall score + reasons; the richer breakdown fields are
   composed by services/aiService.analyzePurchaseFull from the same
   wardrobe (duplicate detection + compatibility), so every number traces
   back to the user's real items. */

export type PurchaseVerdict = "BUY" | "CONSIDER" | "SKIP";

export interface PurchaseAnalysis {
  id: number;
  userId: number;
  /** Catalog product id when the candidate came from Smart Shop. */
  productId: string | null;
  productName: string;
  price: number;
  mrp: number | null;
  verdict: PurchaseVerdict;
  /** Overall wardrobe value score, 0–100 (the server's `score`). */
  wardrobeValue: number;
  duplicateScore: number | null; // 0–100, null until duplicate check runs
  versatilityScore: number | null;
  compatibilityScore: number | null;
  wardrobeImpact: string;
  matchingItemIds: number[];
  similarItemIds: number[];
  reasons: string[];
  cautions: string[];
  aiSummary: string;
  projectedOutfits: number | null;
  projectedCostPerWear: number | null;
  createdAt: string | null; // ISO instant
}
