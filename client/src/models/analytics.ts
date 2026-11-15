/* WardrobeAnalytics (brief §11) — a DERIVED view, never stored.
   selectors.computeAnalytics builds this from wardrobe + outfits on
   every read, so wearing, adding or deleting an item updates every
   number everywhere at once. costPerWear = purchasePrice / max(timesWorn, 1). */

export interface WardrobeAnalytics {
  totalItems: number;
  totalOutfits: number;
  favoriteItems: number;
  unusedItems: number;
  frequentlyUsedItems: number;
  wardrobeHealthScore: number; // 0–100
  versatilityScore: number; // 0–100
  colorBalanceScore: number; // 0–100
  usageScore: number; // 0–100
  occasionCoverageScore: number; // 0–100
  totalWardrobeValue: number; // ₹ sum of purchase prices
  averageCostPerWear: number; // ₹
}

export const EMPTY_ANALYTICS: WardrobeAnalytics = {
  totalItems: 0, totalOutfits: 0, favoriteItems: 0, unusedItems: 0,
  frequentlyUsedItems: 0, wardrobeHealthScore: 0, versatilityScore: 0,
  colorBalanceScore: 0, usageScore: 0, occasionCoverageScore: 0,
  totalWardrobeValue: 0, averageCostPerWear: 0,
};
