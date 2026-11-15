/* Confidence Engine (§9) — confidence is a function of how much real
   data backs a recommendation, never a decoration. A thin wardrobe or
   zero feedback history caps confidence honestly. */

import { normalizeScore } from "./scoringEngine";

export interface ConfidenceInputs {
  itemCount: number;
  feedbackCount: number;
  /** 0–1 share of items with complete attributes (fit/occasions set). */
  attributeCompleteness?: number;
  /** True when the thing being judged (e.g. a product) is fully described. */
  subjectKnown?: boolean;
}

export function computeConfidence(input: ConfidenceInputs): number {
  const wardrobeDepth = Math.min(30, input.itemCount * 1.5); // 20+ pieces → full marks
  const feedbackDepth = Math.min(25, input.feedbackCount * 2.5); // 10+ signals → full marks
  const completeness = 25 * (input.attributeCompleteness ?? 0.7);
  const subject = input.subjectKnown === false ? 8 : 20;
  return normalizeScore(wardrobeDepth + feedbackDepth + completeness + subject);
}

export function confidenceLabel(confidence: number): string {
  if (confidence >= 80) return "High confidence";
  if (confidence >= 60) return "Good confidence";
  if (confidence >= 40) return "Building confidence — rate a few outfits and this sharpens";
  return "Early days — add pieces and feedback so WearWise can be sure";
}
