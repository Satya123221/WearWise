/* Explanation Engine (§10) — reasons are built from the actual
   factors and context that produced a score. No generic filler: every
   line names a real fact (a colour, a count, a past rating). */

export interface ExplanationFacts {
  topFactorLabel?: string;
  topFactorScore?: number;
  preferredColorHit?: string | null;
  compatibleCount?: number;
  occasion?: string;
  likedSimilarBefore?: boolean;
  fillsGap?: string | null;
  duplicateWarning?: string | null;
}

export function buildReasons(facts: ExplanationFacts): { reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (facts.topFactorLabel && typeof facts.topFactorScore === "number" && facts.topFactorScore >= 75) {
    reasons.push(`${facts.topFactorLabel} is strong here (${facts.topFactorScore}/100)`);
  }
  if (facts.preferredColorHit) reasons.push(`Built on ${facts.preferredColorHit} — one of the colours you reach for most`);
  if (typeof facts.compatibleCount === "number" && facts.compatibleCount > 0) {
    reasons.push(`Works with ${facts.compatibleCount} item${facts.compatibleCount === 1 ? "" : "s"} already in your wardrobe`);
  }
  if (facts.occasion) reasons.push(`Formality and pieces land right for ${facts.occasion}`);
  if (facts.likedSimilarBefore) reasons.push("Similar to outfits you rated highly before");
  if (facts.fillsGap) reasons.push(`Fills a real gap: ${facts.fillsGap}`);
  if (facts.duplicateWarning) warnings.push(facts.duplicateWarning);
  if (reasons.length === 0) reasons.push("Best available match from the pieces you own right now");
  return { reasons, warnings };
}
