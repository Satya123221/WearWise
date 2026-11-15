/* PackingPlan (brief §12). References wardrobe item IDs only — the
   packing assistant never invents duplicate clothing objects. Essentials
   the user does not own are plain labels, flagged as not-owned by the
   service that built the plan. */

export interface PackingPlan {
  id: string;
  destination: string;
  startDate: string | null; // ISO date
  endDate: string | null; // ISO date
  duration: number; // days
  tripType: string;
  selectedItemIds: number[];
  generatedOutfitIds: number[];
  essentials: string[];
}
