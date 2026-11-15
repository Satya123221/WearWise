/* WearWise shared data models — the single vocabulary every feature
   speaks. See DATA-PLAN.md ("Shared data model & global state") for how
   these map onto the server contract and where each one is produced. */

export type { UserProfile, UserPreferences } from "./user";
export { EMPTY_PREFERENCES } from "./user";
export type { StyleDNA } from "./styleDNA";
export { EMPTY_STYLE_DNA, STYLE_DNA_DIMENSIONS } from "./styleDNA";
export type {
  ClothingItem, ClothingAIAttributes, ClothingCategory, ClothingSubcategory, ClothingSlot,
} from "./clothing";
export { SLOT_TO_CATEGORY } from "./clothing";
export type { Outfit, OutfitFeedback, OutfitFeedbackType } from "./outfit";
export { RATING_TO_FEEDBACK } from "./outfit";
export type { Product } from "./product";
export type { PurchaseAnalysis, PurchaseVerdict } from "./purchase";
export type { WardrobeAnalytics } from "./analytics";
export { EMPTY_ANALYTICS } from "./analytics";
export type { WardrobeGap, WardrobeInsight, GapPriority, InsightType, InsightSeverity } from "./insight";
export type { PackingPlan } from "./packing";
export type {
  WearLogEntry, RepeatWarning, RepeatCheck, RepeatRadar,
  SevenWays, ItemChallenge, DeadStockEntry, DeadStock,
  TomorrowWeather, TomorrowPlanData, ColourSeason,
} from "./unique";
export type {
  RecommendationType, Recommendation, PreferenceWeights, StyleEngineProfile,
  AIMemory, RecommendationContext, FeedbackReason, WardrobeROIItem,
  StyleEvolutionPoint, SmartNotification, AIEvaluationSummary,
} from "./intelligence";
export { FEEDBACK_REASONS } from "./intelligence";
