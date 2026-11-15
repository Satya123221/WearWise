/* WearWise Intelligence Layer — one entry point (§1, §2).
   Context → Style → Preference → Recommendation → Scoring →
   Confidence + Explanation → Feedback → Personalization → loop.
   Server-side mirrors live in server/src/actions.ts (the durable
   engines over the user's rows); these are the pure client engines
   over the shared store. See AI_ARCHITECTURE.md. */

export { getRecommendationContext, buildMemory } from "./contextEngine";
export { buildStyleProfile } from "./styleEngine";
export { computePreferenceWeights, preferenceDelta } from "./preferenceEngine";
export { recommend, type RecommendInput } from "./recommendationEngine";
export { blendScores, normalizeScore, DEFAULT_WEIGHTS, type ScoringWeights } from "./scoringEngine";
export { computeConfidence, confidenceLabel } from "./confidenceEngine";
export { buildReasons, type ExplanationFacts } from "./explanationEngine";
export { describePreferenceEffect } from "./personalizationEngine";
