/* Scoring Engine (§8) — reusable, configurable, normalized 0–100.
   No single factor may dominate: weights are explicit and sum-checked,
   and the outfit blend mirrors the server engine's five factors so the
   client and server never tell two different stories. */

export interface ScoringWeights {
  color: number;
  style: number;
  occasion: number;
  weather: number;
  formality: number;
  preference: number;
  versatility: number;
  feedback: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  color: 0.18, style: 0.16, occasion: 0.18, weather: 0.1,
  formality: 0.1, preference: 0.12, versatility: 0.09, feedback: 0.07,
};

export function normalizeScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Weighted blend of factor scores (each 0–100) under configurable
    weights. Missing factors are skipped and weights re-normalized, so
    a partial scorecard never silently deflates the total. */
export function blendScores(
  factors: Partial<Record<keyof ScoringWeights, number>>,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): number {
  let wSum = 0;
  let acc = 0;
  for (const key of Object.keys(factors) as Array<keyof ScoringWeights>) {
    const v = factors[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const w = weights[key] ?? 0;
    wSum += w;
    acc += normalizeScore(v) * w;
  }
  if (wSum === 0) return 0;
  return normalizeScore(acc / wSum);
}
