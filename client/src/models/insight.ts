/* WardrobeGap + WardrobeInsight (brief §9, §10). One gap model feeds both
   Smart Shop and Wardrobe Analytics; one insight model feeds the
   dashboard feed and the analytics page. */

export type GapPriority = "High" | "Medium" | "Low";

export interface WardrobeGap {
  id: string;
  category: string;
  itemType: string;
  priority: GapPriority;
  reason: string;
  potentialOutfitCount: number;
  matchingExistingItemIds: number[];
  recommended: boolean;
}

export type InsightType =
  | "UnusedItem" | "Duplicate" | "WardrobeGap" | "HighValueItem"
  | "LowValueItem" | "ColorImbalance" | "StyleInsight" | "PurchaseWarning";

export type InsightSeverity = "info" | "opportunity" | "warning";

export interface WardrobeInsight {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  severity: InsightSeverity;
  relatedItemIds: number[];
  action: string;
  createdAt: string; // ISO instant (derived insights: time of derivation)
}
