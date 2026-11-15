/* User Analytics (§18) — user-facing facts only, all derived from the
   shared wardrobe via the central selectors. No internal metrics leak
   into this surface. */

import type { WearWiseState } from "../store/wearWiseReducer";
import { computeAnalytics, getCategoryCounts, getColorDistribution, getMostWornItems } from "../store/selectors";

export function computeUserAnalytics(state: WearWiseState) {
  const analytics = computeAnalytics(state);
  const categories = getCategoryCounts(state);
  const colors = getColorDistribution(state);
  const byWearAsc = [...state.wardrobe].sort((a, b) => a.timesWorn - b.timesWorn);
  return {
    wardrobeSize: analytics.totalItems,
    mostWornCategory: categories[0]?.category ?? "—",
    leastWornCategory: categories.length ? categories[categories.length - 1]!.category : "—",
    favoriteColor: colors[0]?.color ?? "—",
    mostUsedPiece: getMostWornItems(state, 1)[0]?.name ?? "—",
    leastUsedPiece: byWearAsc[0]?.name ?? "—",
    averageCostPerWear: analytics.averageCostPerWear,
    unusedItems: analytics.unusedItems,
    totalWardrobeValue: analytics.totalWardrobeValue,
    healthScore: analytics.wardrobeHealthScore,
  };
}
