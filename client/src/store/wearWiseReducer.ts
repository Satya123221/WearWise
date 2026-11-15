/* wearWiseReducer — the single state transition function for WearWise
   (brief §14, §15, §16, §22).
 *
   Invariants enforced here:
   - One wardrobe array is the source of truth; analytics, Style DNA
     completion and insights are derived by selectors, never stored.
   - Outfits hold item IDs only. Deleting an item does NOT rewrite
     outfits — selectors resolve IDs defensively, so a deleted piece
     degrades an outfit gracefully instead of breaking it.
   - MARK_OUTFIT_WORN updates every referenced item's timesWorn +
     lastWorn in the same transition (the feedback loop of §18).
   - Unknown IDs are no-ops, never throws. */

import type {
  ClothingItem, Outfit, OutfitFeedback, PackingPlan, Product,
  PurchaseAnalysis, StyleDNA, UserPreferences, UserProfile, WardrobeGap, WardrobeInsight,
} from "../models";
import { EMPTY_PREFERENCES } from "../models";
import type { UiState, WearWiseAction } from "./actions";

export interface WearWiseState {
  user: UserProfile | null;
  wardrobe: ClothingItem[];
  outfits: Outfit[];
  outfitFeedback: OutfitFeedback[];
  styleDNA: StyleDNA | null;
  products: Product[];
  purchaseAnalyses: PurchaseAnalysis[];
  wardrobeGaps: WardrobeGap[];
  /** Derived by selectors.deriveInsights — kept in state only as the
      last computed snapshot for consumers that need a stable list. */
  insights: WardrobeInsight[];
  packingPlans: PackingPlan[];
  preferences: UserPreferences;
  uiState: UiState;
}

export const initialState: WearWiseState = {
  user: null,
  wardrobe: [],
  outfits: [],
  outfitFeedback: [],
  styleDNA: null,
  products: [],
  purchaseAnalyses: [],
  wardrobeGaps: [],
  insights: [],
  packingPlans: [],
  preferences: { ...EMPTY_PREFERENCES },
  uiState: { currentView: "home", ai: {}, aiError: {} },
};

function mapItem(state: WearWiseState, itemId: number, fn: (i: ClothingItem) => ClothingItem): WearWiseState {
  if (!state.wardrobe.some((i) => i.id === itemId)) return state; // invalid ID → no-op (§22)
  return { ...state, wardrobe: state.wardrobe.map((i) => (i.id === itemId ? fn(i) : i)) };
}

function wornPatch(at: string | undefined): Partial<ClothingItem> {
  return { lastWorn: at ?? new Date().toISOString() };
}

export function wearWiseReducer(state: WearWiseState, action: WearWiseAction): WearWiseState {
  switch (action.type) {
    case "SET_USER":
      return { ...state, user: action.user };
    case "HYDRATE_WARDROBE":
      return { ...state, wardrobe: action.items };
    case "HYDRATE_OUTFITS":
      return { ...state, outfits: action.outfits };
    case "HYDRATE_PRODUCTS":
      return { ...state, products: action.products };
    case "HYDRATE_ANALYSES":
      return { ...state, purchaseAnalyses: action.analyses };
    case "HYDRATE_GAPS":
      return { ...state, wardrobeGaps: action.gaps };
    case "HYDRATE_STYLE_DNA":
      return { ...state, styleDNA: action.styleDNA };
    case "HYDRATE_PACKING":
      return {
        ...state,
        packingPlans: [action.plan, ...state.packingPlans.filter((p) => p.id !== action.plan.id)],
      };

    case "ADD_CLOTHING":
      return { ...state, wardrobe: [action.item, ...state.wardrobe.filter((i) => i.id !== action.item.id)] };
    case "UPDATE_CLOTHING":
      return mapItem(state, action.itemId, (i) => ({ ...i, ...action.patch, id: i.id }));
    case "DELETE_CLOTHING":
      // Outfits keep the (now dangling) ID on purpose — resolveOutfitItems
      // drops it at read time. Feedback and analyses keep history.
      return { ...state, wardrobe: state.wardrobe.filter((i) => i.id !== action.itemId) };
    case "TOGGLE_FAVORITE":
      return mapItem(state, action.itemId, (i) => ({ ...i, favorite: !i.favorite }));
    case "MARK_ITEM_WORN":
      return mapItem(state, action.itemId, (i) => ({ ...i, timesWorn: i.timesWorn + 1, ...wornPatch(action.at) }));
    case "UPDATE_WEAR_COUNT":
      return mapItem(state, action.itemId, (i) => ({ ...i, timesWorn: Math.max(0, action.timesWorn) }));
    case "SET_LAST_WORN":
      return mapItem(state, action.itemId, (i) => ({ ...i, lastWorn: action.at }));

    case "ADD_OUTFIT":
    case "SAVE_OUTFIT": {
      const rest = action.outfit.id !== null
        ? state.outfits.filter((o) => o.id !== action.outfit.id)
        : state.outfits;
      return { ...state, outfits: [action.outfit, ...rest] };
    }
    case "DELETE_OUTFIT":
      return { ...state, outfits: state.outfits.filter((o) => o.id !== action.outfitId) };
    case "FAVORITE_OUTFIT":
      return {
        ...state,
        outfits: state.outfits.map((o) => (o.id === action.outfitId ? { ...o, favorite: !o.favorite } : o)),
      };
    case "MARK_OUTFIT_WORN": {
      const ids = new Set(action.itemIds);
      const next: WearWiseState = {
        ...state,
        wardrobe: state.wardrobe.map((i) =>
          ids.has(i.id) ? { ...i, timesWorn: i.timesWorn + 1, ...wornPatch(action.at) } : i),
        outfits: action.outfitId !== null
          ? state.outfits.map((o) => (o.id === action.outfitId ? { ...o, worn: true } : o))
          : state.outfits,
      };
      return next;
    }
    case "RATE_OUTFIT": {
      if (!state.user) return state;
      const entry: OutfitFeedback = {
        id: Date.now(),
        outfitId: action.outfitId,
        userId: state.user.id,
        rating: null,
        feedbackType: action.feedbackType,
        createdAt: new Date().toISOString(),
      };
      return { ...state, outfitFeedback: [entry, ...state.outfitFeedback].slice(0, 100) };
    }
    case "REMIX_OUTFIT":
      return { ...state, outfits: [action.outfit, ...state.outfits].slice(0, 50) };

    case "ADD_PURCHASE_ANALYSIS":
      return {
        ...state,
        purchaseAnalyses: [action.analysis, ...state.purchaseAnalyses.filter((a) => a.id !== action.analysis.id)],
      };
    case "SET_PREFERENCES":
      return {
        ...state,
        preferences: action.preferences,
        user: state.user ? { ...state.user, preferences: action.preferences } : state.user,
      };
    case "SET_VIEW":
      if (state.uiState.currentView === action.view) return state;
      return { ...state, uiState: { ...state.uiState, currentView: action.view } };
    case "SET_AI_STATE":
      return {
        ...state,
        uiState: {
          ...state.uiState,
          ai: { ...state.uiState.ai, [action.operation]: action.status },
          aiError: action.error
            ? { ...state.uiState.aiError, [action.operation]: action.error }
            : state.uiState.aiError,
        },
      };
    case "RESET_SESSION":
      return { ...initialState, preferences: state.preferences, uiState: { ...initialState.uiState, currentView: state.uiState.currentView } };
    default:
      return state;
  }
}
