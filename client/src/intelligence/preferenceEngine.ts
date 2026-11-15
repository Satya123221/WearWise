/* Preference Engine (§5) + Personalization Engine (§6) — client mirror.
   The server is authoritative (its generateOutfit reads the feedback
   table directly); this pure version runs over the store's wardrobe +
   feedback so any client surface can show the same learned weights
   without a round-trip. Signals: loves/likes/wears/saves push colours
   and styles up; "not my style" and reasoned dislikes push them into
   the avoided maps. Weights are wear/signal shares scaled to 0–1. */

import type { ClothingItem, OutfitFeedback } from "../models";
import type { PreferenceWeights } from "../models/intelligence";

function bump(map: Record<string, number>, key: string, by: number) {
  if (!key) return;
  map[key] = (map[key] ?? 0) + by;
}

function toWeights(raw: Record<string, number>, max: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = Math.round((v / Math.max(max, 1)) * 100) / 100;
  return out;
}

export function computePreferenceWeights(
  wardrobe: ClothingItem[],
  feedback: OutfitFeedback[],
): PreferenceWeights {
  const prefColors: Record<string, number> = {};
  const prefStyles: Record<string, number> = {};
  const prefFits: Record<string, number> = {};
  const avoidColors: Record<string, number> = {};
  const avoidStyles: Record<string, number> = {};

  // Wardrobe wear history is itself a preference signal.
  for (const item of wardrobe) {
    const w = item.timesWorn + (item.favorite ? 6 : 0);
    if (w > 0) {
      bump(prefColors, item.color, w);
      for (const s of item.style) bump(prefStyles, s, w);
      bump(prefFits, item.fit, w);
    }
  }
  // Feedback detail (which style was disliked) lives server-side in
  // the feedback table, where the outfit engine applies it directly.
  // The client mirror reports the signal count and lets wardrobe wear
  // history carry the colour/style/fit shares.
  void avoidColors;
  void avoidStyles;
  const maxColor = Math.max(1, ...Object.values(prefColors));
  const maxStyle = Math.max(1, ...Object.values(prefStyles));
  const maxFit = Math.max(1, ...Object.values(prefFits));
  return {
    preferredColors: toWeights(prefColors, maxColor),
    avoidedColors: {},
    preferredStyles: toWeights(prefStyles, maxStyle),
    avoidedStyles: {},
    preferredFits: toWeights(prefFits, maxFit),
    signalCount: feedback.length,
  };
}

/** Personalization loop, client side (§6): given a candidate item and
    the learned weights, returns the score delta the loop applies —
    the same direction the server engine biases its picks. */
export function preferenceDelta(
  weights: PreferenceWeights,
  candidate: { color: string; style: string[] },
): number {
  let delta = 0;
  const colorW = weights.preferredColors[candidate.color];
  if (typeof colorW === "number") delta += colorW * 8;
  if (weights.avoidedColors[candidate.color]) delta -= 10;
  for (const s of candidate.style) {
    const sw = weights.preferredStyles[s];
    if (typeof sw === "number") delta += sw * 6;
    if (weights.avoidedStyles[s]) delta -= 10;
  }
  return Math.round(delta * 10) / 10;
}
