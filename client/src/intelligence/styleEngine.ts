/* Style Engine (§4) — consumes wardrobe (+ Style DNA when present)
   and produces the structured style profile every feature shares.
   Everything is wear-weighted from real rows; nothing is hardcoded. */

import type { ClothingItem, StyleDNA } from "../models";
import type { StyleEngineProfile } from "../models/intelligence";

function topKeys(counts: Map<string, number>, n: number): string[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

export function buildStyleProfile(wardrobe: ClothingItem[], dna: StyleDNA | null): StyleEngineProfile {
  const wear = (i: ClothingItem) => i.timesWorn + 2;
  const colors = new Map<string, number>();
  const fits = new Map<string, number>();
  const patterns = new Map<string, number>();
  const categories = new Map<string, number>();
  const occasions = new Map<string, number>();
  let formalSum = 0;
  let ethnicWear = 0;
  let totalWear = 0;
  for (const i of wardrobe) {
    const w = wear(i);
    totalWear += w;
    colors.set(i.color, (colors.get(i.color) ?? 0) + w);
    fits.set(i.fit, (fits.get(i.fit) ?? 0) + w);
    patterns.set(i.pattern, (patterns.get(i.pattern) ?? 0) + w);
    categories.set(i.category, (categories.get(i.category) ?? 0) + w);
    formalSum += i.formality * w;
    if (i.slot === "ethnic") ethnicWear += w;
    for (const o of i.occasions) occasions.set(o, (occasions.get(o) ?? 0) + w);
  }
  const shoes = wardrobe.filter((i) => i.slot === "shoes").sort((a, b) => b.timesWorn - a.timesWorn)[0];
  const layers = wardrobe.filter((i) => i.slot === "outerwear").length;
  const avgFormality = totalWear ? formalSum / totalWear : 2.5;
  const traditionalShare = totalWear ? Math.round((ethnicWear / totalWear) * 100) : 0;
  const archetype = dna
    ? Object.entries({
        Minimal: dna.minimal, Casual: dna.casual, "Smart Casual": dna.smartCasual,
        Streetwear: dna.streetwear, Classic: dna.classic, Traditional: dna.traditional,
      }).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Casual"
    : topKeys(categories, 1)[0] ?? "Casual";
  return {
    archetype,
    preferredColors: topKeys(colors, 4),
    avoidedColors: [],
    preferredFits: topKeys(fits, 2),
    preferredPatterns: topKeys(patterns, 2),
    formalityPreference: `Averages ${avgFormality.toFixed(1)} of 5 — ${avgFormality >= 3.4 ? "leans smart/formal" : avgFormality <= 2.2 ? "leans relaxed/casual" : "sits in the smart-casual middle"}`,
    favoriteCategories: topKeys(categories, 3),
    preferredFootwear: shoes ? `${shoes.category} (${shoes.color})` : "Not enough footwear data yet",
    layeringPreference: layers >= 3 ? "Layers often — jackets and overshirts are a real part of the rotation" : layers > 0 ? "Occasional layering" : "Rarely layers — no outerwear in rotation yet",
    traditionalShare,
    westernShare: 100 - traditionalShare,
    occasionPreferences: topKeys(occasions, 4),
  };
}
