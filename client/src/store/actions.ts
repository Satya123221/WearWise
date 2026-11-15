/* Central action creators (brief §15, §16, §23).
   Two families live here:
   - Domain actions (ADD_CLOTHING, MARK_OUTFIT_WORN, RATE_OUTFIT, …) —
     dispatched by the provider after the matching server action
     succeeds, and applied by wearWiseReducer to the shared state.
   - Hydration actions (HYDRATE_*) — the provider's single sync point
     where server query results enter the store.
   AI *operations* (generate, analyze, detect…) are async service calls,
   not reducer actions — they live in services/aiService.ts and report
   progress through SET_AI_STATE (idle → loading → success → error). */

import type {
  ClothingItem, Outfit, OutfitFeedbackType, PackingPlan, Product,
  PurchaseAnalysis, StyleDNA, UserPreferences, UserProfile, WardrobeGap,
} from "../models";

export type AiOperation =
  | "generateOutfit" | "analyzeClothing" | "analyzeOutfit" | "analyzePurchase"
  | "detectDuplicates" | "styleDNA" | "wardrobeGaps" | "packing" | "remix" | "insights";

export type AiStatus = "idle" | "loading" | "success" | "error";

export interface UiState {
  currentView: string;
  ai: Partial<Record<AiOperation, AiStatus>>;
  aiError: Partial<Record<AiOperation, string>>;
}

export type WearWiseAction =
  /* session + hydration */
  | { type: "SET_USER"; user: UserProfile | null }
  | { type: "HYDRATE_WARDROBE"; items: ClothingItem[] }
  | { type: "HYDRATE_OUTFITS"; outfits: Outfit[] }
  | { type: "HYDRATE_PRODUCTS"; products: Product[] }
  | { type: "HYDRATE_ANALYSES"; analyses: PurchaseAnalysis[] }
  | { type: "HYDRATE_GAPS"; gaps: WardrobeGap[] }
  | { type: "HYDRATE_STYLE_DNA"; styleDNA: StyleDNA | null }
  | { type: "HYDRATE_PACKING"; plan: PackingPlan }
  /* wardrobe (§15) */
  | { type: "ADD_CLOTHING"; item: ClothingItem }
  | { type: "UPDATE_CLOTHING"; itemId: number; patch: Partial<ClothingItem> }
  | { type: "DELETE_CLOTHING"; itemId: number }
  | { type: "TOGGLE_FAVORITE"; itemId: number }
  | { type: "MARK_ITEM_WORN"; itemId: number; at?: string }
  | { type: "UPDATE_WEAR_COUNT"; itemId: number; timesWorn: number }
  | { type: "SET_LAST_WORN"; itemId: number; at: string | null }
  /* outfits (§16) */
  | { type: "ADD_OUTFIT"; outfit: Outfit }
  | { type: "SAVE_OUTFIT"; outfit: Outfit }
  | { type: "DELETE_OUTFIT"; outfitId: number }
  | { type: "FAVORITE_OUTFIT"; outfitId: number }
  | { type: "MARK_OUTFIT_WORN"; outfitId: number | null; itemIds: number[]; at?: string }
  | { type: "RATE_OUTFIT"; outfitId: number | null; feedbackType: OutfitFeedbackType }
  | { type: "REMIX_OUTFIT"; outfitId: number | null; outfit: Outfit }
  /* shopping + preferences + ui (§13, §23) */
  | { type: "ADD_PURCHASE_ANALYSIS"; analysis: PurchaseAnalysis }
  | { type: "SET_PREFERENCES"; preferences: UserPreferences }
  | { type: "SET_VIEW"; view: string }
  | { type: "SET_AI_STATE"; operation: AiOperation; status: AiStatus; error?: string }
  | { type: "RESET_SESSION" };

/* Typed creators — call sites never hand-write action objects. */
export const actions = {
  setUser: (user: UserProfile | null): WearWiseAction => ({ type: "SET_USER", user }),
  hydrateWardrobe: (items: ClothingItem[]): WearWiseAction => ({ type: "HYDRATE_WARDROBE", items }),
  hydrateOutfits: (outfits: Outfit[]): WearWiseAction => ({ type: "HYDRATE_OUTFITS", outfits }),
  hydrateProducts: (products: Product[]): WearWiseAction => ({ type: "HYDRATE_PRODUCTS", products }),
  hydrateAnalyses: (analyses: PurchaseAnalysis[]): WearWiseAction => ({ type: "HYDRATE_ANALYSES", analyses }),
  hydrateGaps: (gaps: WardrobeGap[]): WearWiseAction => ({ type: "HYDRATE_GAPS", gaps }),
  hydrateStyleDNA: (styleDNA: StyleDNA | null): WearWiseAction => ({ type: "HYDRATE_STYLE_DNA", styleDNA }),
  hydratePacking: (plan: PackingPlan): WearWiseAction => ({ type: "HYDRATE_PACKING", plan }),
  addClothing: (item: ClothingItem): WearWiseAction => ({ type: "ADD_CLOTHING", item }),
  updateClothing: (itemId: number, patch: Partial<ClothingItem>): WearWiseAction => ({ type: "UPDATE_CLOTHING", itemId, patch }),
  deleteClothing: (itemId: number): WearWiseAction => ({ type: "DELETE_CLOTHING", itemId }),
  toggleFavorite: (itemId: number): WearWiseAction => ({ type: "TOGGLE_FAVORITE", itemId }),
  markItemWorn: (itemId: number, at?: string): WearWiseAction => ({ type: "MARK_ITEM_WORN", itemId, at }),
  updateWearCount: (itemId: number, timesWorn: number): WearWiseAction => ({ type: "UPDATE_WEAR_COUNT", itemId, timesWorn }),
  setLastWorn: (itemId: number, at: string | null): WearWiseAction => ({ type: "SET_LAST_WORN", itemId, at }),
  addOutfit: (outfit: Outfit): WearWiseAction => ({ type: "ADD_OUTFIT", outfit }),
  saveOutfit: (outfit: Outfit): WearWiseAction => ({ type: "SAVE_OUTFIT", outfit }),
  deleteOutfit: (outfitId: number): WearWiseAction => ({ type: "DELETE_OUTFIT", outfitId }),
  favoriteOutfit: (outfitId: number): WearWiseAction => ({ type: "FAVORITE_OUTFIT", outfitId }),
  markOutfitWorn: (outfitId: number | null, itemIds: number[], at?: string): WearWiseAction => ({ type: "MARK_OUTFIT_WORN", outfitId, itemIds, at }),
  rateOutfit: (outfitId: number | null, feedbackType: OutfitFeedbackType): WearWiseAction => ({ type: "RATE_OUTFIT", outfitId, feedbackType }),
  remixOutfit: (outfitId: number | null, outfit: Outfit): WearWiseAction => ({ type: "REMIX_OUTFIT", outfitId, outfit }),
  addPurchaseAnalysis: (analysis: PurchaseAnalysis): WearWiseAction => ({ type: "ADD_PURCHASE_ANALYSIS", analysis }),
  setPreferences: (preferences: UserPreferences): WearWiseAction => ({ type: "SET_PREFERENCES", preferences }),
  setView: (view: string): WearWiseAction => ({ type: "SET_VIEW", view }),
  setAiState: (operation: AiOperation, status: AiStatus, error?: string): WearWiseAction => ({ type: "SET_AI_STATE", operation, status, error }),
  resetSession: (): WearWiseAction => ({ type: "RESET_SESSION" }),
};
