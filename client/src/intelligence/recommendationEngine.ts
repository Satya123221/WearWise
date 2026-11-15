/* Recommendation Engine (§7) — the centralized interface. Features
   ask for a typed recommendation and always get back score +
   confidence + reasons + warnings. The heavy lifting (outfit building,
   purchase scoring) stays in the server actions via aiService; this
   engine is the client-side contract that wraps any candidate with
   the intelligence layer's scoring, confidence and explanation, so no
   surface ever renders a bare, unexplained number again. */

import type { Recommendation, RecommendationType } from "../models/intelligence";
import { blendScores, type ScoringWeights } from "./scoringEngine";
import { computeConfidence } from "./confidenceEngine";
import { buildReasons, type ExplanationFacts } from "./explanationEngine";

export interface RecommendInput<T> {
  type: RecommendationType;
  payload: T;
  factors: Partial<Record<keyof ScoringWeights, number>>;
  context: { itemCount: number; feedbackCount: number; attributeCompleteness?: number; subjectKnown?: boolean };
  facts: ExplanationFacts;
}

export function recommend<T>(input: RecommendInput<T>): Recommendation<T> {
  const score = blendScores(input.factors);
  const confidence = computeConfidence(input.context);
  const { reasons, warnings } = buildReasons(input.facts);
  return { type: input.type, payload: input.payload, score, confidence, reasons, warnings };
}
