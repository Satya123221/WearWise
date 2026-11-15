/* Context Engine (§3) — focused context builders. Each returns only
   what one kind of recommendation needs, assembled from the central
   store state: profile, wardrobe, Style DNA, preferences, feedback.
   Weather/occasion/trip inputs are passed in by the caller, never
   fetched globally. */

import type { WearWiseState } from "../store/wearWiseReducer";
import type { AIMemory, RecommendationContext } from "../models/intelligence";
import { buildStyleProfile } from "./styleEngine";
import { computePreferenceWeights } from "./preferenceEngine";
import { getColorDistribution } from "../store/selectors";

export function buildMemory(state: WearWiseState): AIMemory {
  const style = buildStyleProfile(state.wardrobe, state.styleDNA);
  const brandCounts = new Map<string, number>();
  for (const i of state.wardrobe) if (i.brand) brandCounts.set(i.brand, (brandCounts.get(i.brand) ?? 0) + i.timesWorn + 1);
  const brands = [...brandCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b]) => b);
  return {
    favoriteColors: style.preferredColors,
    avoidedColors: style.avoidedColors,
    favoriteFits: style.preferredFits,
    favoriteStyles: state.preferences.preferredStyles.length ? state.preferences.preferredStyles : [style.archetype],
    favoriteOccasions: style.occasionPreferences,
    preferredFootwear: style.preferredFootwear,
    preferredBrands: brands,
    budgetRange: state.preferences.budgetRange || "Not set",
    traditionalWestern: style.traditionalShare >= 40
      ? "Traditional-leaning — ethnic wear is a core part of the rotation"
      : style.traditionalShare >= 12
        ? "Mostly western, traditional for festive and family occasions"
        : "Mostly western",
    layeringPreference: style.layeringPreference,
  };
}

/** The full context for a recommendation run — still focused: counts,
    top colours and the three engine outputs, not raw row dumps. */
export function getRecommendationContext(state: WearWiseState): RecommendationContext {
  const preferences = computePreferenceWeights(state.wardrobe, state.outfitFeedback);
  return {
    itemCount: state.wardrobe.length,
    feedbackCount: state.outfitFeedback.length,
    favoriteCount: state.wardrobe.filter((i) => i.favorite).length,
    slotsCovered: [...new Set(state.wardrobe.map((i) => i.slot))],
    topColors: getColorDistribution(state).slice(0, 4).map((c) => c.color),
    style: buildStyleProfile(state.wardrobe, state.styleDNA),
    preferences,
    memory: buildMemory(state),
  };
}
