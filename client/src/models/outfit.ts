/* Outfit + OutfitFeedback (brief §4, §5).
   An outfit stores item IDs only — never copies of clothing objects — so
   editing or wearing an item is reflected in every outfit that uses it.
   Resolve IDs to items with selectors.resolveOutfitItems, which drops
   IDs whose item was deleted instead of breaking the UI (§22). */

export interface Outfit {
  /** Server id for saved outfits; null for a freshly generated look. */
  id: number | null;
  userId: number;
  name: string;
  itemIds: number[];
  occasion: string;
  weather: string;
  style: string;
  matchScore: number; // 0–100 overall
  colorScore: number;
  occasionScore: number;
  weatherScore: number;
  styleScore: number;
  /** Fifth engine factor (Phase 5): how widely the pieces pair across
      the wardrobe. Saved outfits predate factor storage, so the mapper
      falls back to their match score there. */
  versatilityScore: number;
  explanation: string;
  createdAt: string | null; // ISO instant
  favorite: boolean;
  worn: boolean;
}

export type OutfitFeedbackType = "Love" | "Like" | "Neutral" | "Dislike";

export interface OutfitFeedback {
  id: number;
  outfitId: number | null;
  userId: number;
  /** 1–5 when a numeric rating exists; feedbackType is the canonical form. */
  rating: number | null;
  feedbackType: OutfitFeedbackType;
  createdAt: string; // ISO instant
}

/** Maps the stylist's 4-point rating onto the feedback model. */
export const RATING_TO_FEEDBACK: Record<"love" | "good" | "unsure" | "not", OutfitFeedbackType> = {
  love: "Love",
  good: "Like",
  unsure: "Neutral",
  not: "Dislike",
};
