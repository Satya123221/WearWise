/* WearWise Intelligence Layer — shared vocabulary (§1–§11 of the
   intelligence brief). Every AI feature speaks through these types:
   a Recommendation always carries score + confidence + reasons, the
   Preference Engine speaks in 0–1 weights, and AI Memory is a small,
   non-sensitive fashion-only profile. The engines that produce these
   live in client/src/intelligence/ (pure, testable) and are mirrored
   server-side in server/src/actions.ts, where the durable rows live. */

export type RecommendationType =
  | "OUTFIT" | "SHOPPING" | "PURCHASE" | "PACKING" | "OCCASION" | "WEATHER" | "GAP" | "REMIX";

/** The one recommendation shape (§7): nothing reaches the UI without a
    score, a confidence, and reasons that came from the actual scoring. */
export interface Recommendation<T> {
  type: RecommendationType;
  payload: T;
  score: number; // 0–100 match/value
  confidence: number; // 0–100 — honesty about how much data backs this
  reasons: string[];
  warnings: string[];
}

/** Preference Engine weights (§5): 0–1, learned from real signals —
    loved/liked/worn/saved push up, "not my style" pushes into avoided. */
export interface PreferenceWeights {
  preferredColors: Record<string, number>;
  avoidedColors: Record<string, number>;
  preferredStyles: Record<string, number>;
  avoidedStyles: Record<string, number>;
  preferredFits: Record<string, number>;
  signalCount: number;
}

/** Style Engine output (§4): a structured profile, derived — never a
    hardcoded personality. */
export interface StyleEngineProfile {
  archetype: string;
  preferredColors: string[];
  avoidedColors: string[];
  preferredFits: string[];
  preferredPatterns: string[];
  formalityPreference: string; // "Mostly smart (3–4 of 5)" style summary
  favoriteCategories: string[];
  preferredFootwear: string;
  layeringPreference: string;
  traditionalShare: number; // 0–100 % of wardrobe that is ethnic/traditional
  westernShare: number;
  occasionPreferences: string[];
}

/** AI Memory (§11): fashion preferences only — no personal data. This
    is the object every feature reads instead of re-deriving taste. */
export interface AIMemory {
  favoriteColors: string[];
  avoidedColors: string[];
  favoriteFits: string[];
  favoriteStyles: string[];
  favoriteOccasions: string[];
  preferredFootwear: string;
  preferredBrands: string[];
  budgetRange: string;
  traditionalWestern: string; // e.g. "Mostly western, festive traditional"
  layeringPreference: string;
}

/** Focused recommendation context (§3): builders return only what a
    feature needs — never the whole app state. */
export interface RecommendationContext {
  itemCount: number;
  feedbackCount: number;
  favoriteCount: number;
  slotsCovered: string[];
  topColors: string[];
  style: StyleEngineProfile;
  preferences: PreferenceWeights;
  memory: AIMemory;
}

/** Advanced feedback reasons (§12) — stored with the rating and used
    by the Preference Engine, not just displayed. */
export const FEEDBACK_REASONS = [
  "Perfect",
  "Too formal",
  "Too casual",
  "Don't like the color",
  "Don't like the combination",
  "Already wear this too often",
  "Not suitable for me",
  "Not comfortable",
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

/** Wardrobe ROI (§13): how much value one piece actually adds. */
export interface WardrobeROIItem {
  itemId: number;
  name: string;
  brand: string;
  roiScore: number; // 0–100
  potentialOutfits: number;
  compatibleItems: number;
  compatibleOccasions: number;
  versatility: number; // 0–100
  wearFrequency: number; // wears
  duplicateRisk: number; // 0–100
  price: number;
  costPerWear: number;
  gapContribution: string;
}

/** Style Evolution (§26): one point per month with real feedback —
    the month's dominant style, from that month's stored signals and
    the wardrobe added then. Months with no signal are not invented. */
export interface StyleEvolutionPoint {
  month: string; // "Nov 2026"
  dominantStyle: string;
  signals: number;
}

/** Smart Notifications (§25): derived nudges, computed — never spam.
    Each carries the view it deep-links to. */
export interface SmartNotification {
  id: string;
  icon: string;
  title: string;
  body: string;
  goto: string;
}

/** AI Evaluation (§16): honest outcome rates from the feedback table.
    Rates are null when there is no data yet — never faked. */
export interface AIEvaluationSummary {
  totalSignals: number;
  accepted: number;
  rejected: number;
  loveRate: number | null;
  dislikeRate: number | null;
  saveRate: number | null;
  wearRate: number | null;
  buyAnalyses: number;
  outfitsSaved: number;
  packingPlans: number;
  topFeature: string;
  weakestFeature: string;
}
