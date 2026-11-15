/* Selectors — every derived number in WearWise is computed here, from
   the central wardrobe state, never stored or maintained by hand
   (brief §11, §21). Pure functions: same input → same output, so the
   dashboard, analytics, shop and profile can never disagree.
 *
   The health / versatility / colour-balance / usage / occasion formulas
   intentionally mirror the server's getInsights dimensions (same rows,
   same math) so the client-derived analytics and the server insight
   feed tell one consistent story. */

import type {
  ClothingAIAttributes, ClothingItem, Outfit, StyleDNA, WardrobeAnalytics, WardrobeInsight,
} from "../models";
import { EMPTY_ANALYTICS } from "../models";
import type { WearWiseState } from "./wearWiseReducer";

export const NEUTRAL_COLORS = new Set([
  "black", "white", "navy", "beige", "grey", "gray", "cream", "charcoal", "olive", "brown", "silver",
]);

const OCCASION_FORMALITY: Record<string, [number, number]> = {
  College: [1, 3], Casual: [1, 3], Date: [2, 4], Party: [2, 4],
  Interview: [4, 5], Wedding: [4, 5], Festive: [3, 5], Travel: [1, 3], Gym: [1, 1],
};

export function getOccasionsForFormality(formality: number): string[] {
  return Object.entries(OCCASION_FORMALITY)
    .filter(([, [lo, hi]]) => formality >= lo && formality <= hi)
    .map(([occasion]) => occasion);
}

/* ---------------- wardrobe basics (§21) ---------------- */

export function getTotalItems(state: WearWiseState): number {
  return state.wardrobe.length;
}

export function getItemById(state: WearWiseState, itemId: number): ClothingItem | undefined {
  return state.wardrobe.find((i) => i.id === itemId);
}

export function getFavoriteItems(state: WearWiseState): ClothingItem[] {
  return state.wardrobe.filter((i) => i.favorite);
}

export function getUnusedItems(state: WearWiseState): ClothingItem[] {
  return state.wardrobe.filter((i) => i.timesWorn < 5);
}

export function getMostWornItems(state: WearWiseState, limit = 5): ClothingItem[] {
  return [...state.wardrobe].sort((a, b) => b.timesWorn - a.timesWorn).slice(0, limit);
}

export function getCostPerWear(item: ClothingItem): number {
  return Math.round(item.purchasePrice / Math.max(item.timesWorn, 1));
}

export function getDaysSinceWorn(item: ClothingItem, nowMs = Date.now()): number | null {
  if (!item.lastWorn) return null;
  return Math.floor((nowMs - new Date(item.lastWorn).getTime()) / 86_400_000);
}

export function getColorDistribution(state: WearWiseState): Array<{ color: string; hex: string; count: number }> {
  const counts = new Map<string, { hex: string; count: number }>();
  for (const item of state.wardrobe) {
    const cur = counts.get(item.color) ?? { hex: item.colorHex, count: 0 };
    cur.count += 1;
    counts.set(item.color, cur);
  }
  return [...counts.entries()]
    .map(([color, v]) => ({ color, hex: v.hex, count: v.count }))
    .sort((a, b) => b.count - a.count);
}

export function getCategoryCounts(state: WearWiseState): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of state.wardrobe) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  return [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
}

/* ---------------- outfits (§22 safety) ---------------- */

/** Resolves an outfit's item IDs against the wardrobe. Deleted items are
    dropped silently — an outfit with a missing piece renders shorter,
    never broken. Invalid/duplicate IDs are ignored. */
export function resolveOutfitItems(state: WearWiseState, outfit: Outfit): ClothingItem[] {
  const seen = new Set<number>();
  const resolved: ClothingItem[] = [];
  for (const id of outfit.itemIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const item = state.wardrobe.find((i) => i.id === id);
    if (item) resolved.push(item);
  }
  return resolved;
}

export function outfitMissingCount(state: WearWiseState, outfit: Outfit): number {
  return outfit.itemIds.length - resolveOutfitItems(state, outfit).length;
}

/* ---------------- analytics (§11) ---------------- */

export function computeAnalytics(state: WearWiseState): WardrobeAnalytics {
  const items = state.wardrobe;
  const total = items.length;
  if (total === 0) return { ...EMPTY_ANALYTICS, totalOutfits: state.outfits.length };
  const pct = (n: number) => Math.round((n / total) * 100);
  const frequent = items.filter((i) => i.timesWorn >= 15).length;
  const rare = items.filter((i) => i.timesWorn < 5).length;
  const slots = new Set(items.map((i) => i.slot));
  const balance = slots.size / 6;
  const health = Math.max(22, Math.min(96, Math.round(38 + balance * 30 + pct(frequent) * 0.28 - pct(rare) * 0.12)));
  const versatility = Math.max(20, Math.min(97, Math.round(30 + slots.size * 9 + Math.min(20, total))));
  const usageScore = Math.max(15, Math.min(97, Math.round(100 - pct(rare) * 0.9 - (100 - pct(frequent)) * 0.15)));
  const neutralShare = items.filter((i) => NEUTRAL_COLORS.has(i.color.toLowerCase())).length / total;
  const colorBalance = Math.max(25, Math.min(96, Math.round(96 - Math.abs(neutralShare - 0.68) * 130)));
  const covered = Object.values(OCCASION_FORMALITY).filter(([lo, hi]) =>
    items.some((i) => i.formality >= lo && i.formality <= hi)).length;
  const occasionCoverage = Math.max(20, Math.min(97, Math.round((covered / Object.keys(OCCASION_FORMALITY).length) * 100)));
  const totalValue = items.reduce((a, i) => a + i.purchasePrice, 0);
  const avgCpw = Math.round(items.reduce((a, i) => a + getCostPerWear(i), 0) / total);
  return {
    totalItems: total,
    totalOutfits: state.outfits.length,
    favoriteItems: items.filter((i) => i.favorite).length,
    unusedItems: rare,
    frequentlyUsedItems: frequent,
    wardrobeHealthScore: health,
    versatilityScore: versatility,
    colorBalanceScore: colorBalance,
    usageScore,
    occasionCoverageScore: occasionCoverage,
    totalWardrobeValue: totalValue,
    averageCostPerWear: avgCpw,
  };
}

export function getWardrobeHealth(state: WearWiseState): number {
  return computeAnalytics(state).wardrobeHealthScore;
}

/* ---------------- Style DNA completion (§6) ---------------- */

/** The server derives six canonical affinities; sporty and trendy are
    completed here from the same wardrobe rows (wear-weighted), so the
    single StyleDNA object in state is always whole. */
export function computeStyleDNA(state: WearWiseState, base: StyleDNA | null): StyleDNA | null {
  if (!base) return null;
  const items = state.wardrobe;
  if (items.length === 0) return base;
  const totalWear = items.reduce((a, i) => a + i.timesWorn + 2, 0) || 1;
  const affinity = (matches: (i: ClothingItem) => boolean): number => {
    const n = items.reduce((a, i) => a + (matches(i) ? i.timesWorn + 2 : 0), 0);
    return Math.max(18, Math.min(94, Math.round(24 + (n / totalWear) * 150)));
  };
  return {
    ...base,
    sporty: affinity((i) => i.style.includes("Sporty") || i.subcategory === "Running Shoes"),
    trendy: affinity((i) => i.style.includes("Trendy") || i.style.includes("Streetwear")),
  };
}

/* ---------------- AI attributes (§3) ---------------- */

/** Deterministic presentation-layer estimates derived from the item's
    own fields. These are NOT a vision model's measured confidence —
    the upload flow presents its scan plainly as a "starting guess". */
export function deriveAiAttributes(item: {
  subcategory: string; color: string; style: string[]; formality: number;
  slot: string; timesWorn: number; season: string[]; pattern: string; material: string;
}): ClothingAIAttributes {
  const seasons = ["All Season", "Summer", "Winter", "Monsoon"];
  return {
    categoryConfidence: 0.9,
    colorConfidence: 0.88,
    styleConfidence: 0.84,
    formalityScore: Math.round((item.formality / 5) * 100) / 100,
    versatilityScore: Math.round(Math.min(0.97, 0.45 + Math.min(item.timesWorn, 30) / 60 + (NEUTRAL_COLORS.has(item.color.toLowerCase()) ? 0.18 : 0)) * 100) / 100,
    seasonSuitability: Object.fromEntries(
      seasons.map((s) => [s, item.season.includes("All Season") || item.season.includes(s) ? 0.92 : 0.35]),
    ),
    detectedFeatures: [item.subcategory, item.pattern, item.material, ...item.style].filter(Boolean),
  };
}

/* ---------------- insights (§10) ---------------- */

/** Derives the insight feed from central state — the same facts the
    server's getInsights surfaces, in the shared WardrobeInsight model. */
export function deriveInsights(state: WearWiseState, nowMs = Date.now()): WardrobeInsight[] {
  const items = state.wardrobe;
  const insights: WardrobeInsight[] = [];
  const now = new Date(nowMs).toISOString();
  const stale = items
    .map((i) => ({ item: i, days: getDaysSinceWorn(i, nowMs) }))
    .filter((x) => (x.days ?? 0) >= 14)
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))[0];
  if (stale) {
    const partner = items.find((i) => i.id !== stale.item.id && i.slot === "bottom");
    insights.push({
      id: `unused-${stale.item.id}`,
      type: "UnusedItem",
      title: `You haven't worn your ${stale.item.name.toLowerCase()} in ${stale.days} days.`,
      description: partner
        ? `Try pairing it with your ${partner.name.toLowerCase()} and your most-worn shoes.`
        : "Build one outfit around it this week before it becomes dead weight.",
      severity: "opportunity",
      relatedItemIds: [stale.item.id, ...(partner ? [partner.id] : [])],
      action: "Generate Outfit",
      createdAt: now,
    });
  }
  for (const gap of state.wardrobeGaps.slice(0, 2)) {
    insights.push({
      id: `gap-insight-${gap.id}`,
      type: "WardrobeGap",
      title: `Missing: ${gap.itemType}`,
      description: gap.reason,
      severity: "opportunity",
      relatedItemIds: gap.matchingExistingItemIds.slice(0, 4),
      action: "Shop the gap",
      createdAt: now,
    });
  }
  const best = [...items].sort((a, b) => getCostPerWear(a) - getCostPerWear(b))[0];
  if (best && items.length > 1) {
    insights.push({
      id: `value-${best.id}`,
      type: "HighValueItem",
      title: `${best.name} is your best-value piece.`,
      description: `At ₹${getCostPerWear(best).toLocaleString("en-IN")} per wear across ${best.timesWorn} wears, it earns its place every week.`,
      severity: "info",
      relatedItemIds: [best.id],
      action: "Generate Outfit",
      createdAt: now,
    });
  }
  const topColors = getColorDistribution(state).filter((c) => items.some((i) => i.slot === "top" && i.color === c.color));
  const heavyTop = topColors[0];
  const topCount = items.filter((i) => i.slot === "top" && i.color === heavyTop?.color).length;
  if (heavyTop && topCount >= 3) {
    insights.push({
      id: `color-${heavyTop.color}`,
      type: "ColorImbalance",
      title: `You own ${topCount} ${heavyTop.color.toLowerCase()} tops.`,
      description: "Consider a different colour for your next top — variety unlocks more outfits than another near-duplicate.",
      severity: "warning",
      relatedItemIds: items.filter((i) => i.slot === "top" && i.color === heavyTop.color).map((i) => i.id),
      action: "Check Buy-or-Skip",
      createdAt: now,
    });
  }
  return insights;
}
