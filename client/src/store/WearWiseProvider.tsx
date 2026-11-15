/* WearWiseProvider — the one global store (brief §14, §18, §20).
 *
 * Data flow (one source of truth):
 *
 *   server actions (durable DB) ──React Query──▶ this provider
 *        ▲                                            │ dispatch HYDRATE_*
 *        │ mutations via services                     ▼
 *   wardrobeService / aiService              WearWiseState (useReducer)
 *                                                     │ selectors
 *                                                     ▼
 *                                     every screen reads the same models
 *
 * The provider owns the core queries (wardrobe, saved outfits, analyses,
 * products, gaps, Style DNA) exactly once, no matter how many screens
 * mount. Screens keep their feature-specific queries (weather card,
 * packing run, remix…) but the shared entities — user, wardrobe,
 * outfits, products, analyses, gaps, Style DNA, preferences — live here.
 *
 * Derived data (analytics, insights, completed Style DNA) is computed
 * by selectors on read and memoized — never stored, never stale.
 * Preferences + UI state persist through storageService (the only
 * localStorage gateway); the wardrobe itself persists server-side. */

import { useQuery } from "@tanstack/react-query";
import {
  createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode,
} from "react";
import { api } from "../api";
import type { UserPreferences, WardrobeAnalytics, WardrobeInsight } from "../models";
import { EMPTY_PREFERENCES } from "../models";
import type { StyleDNA } from "../models";
import { STORAGE_KEYS, storageService } from "../services/storageService";
import {
  toClothingItem, toProduct, toPurchaseAnalysisRow, toSavedOutfit, toStyleDNA, toUserProfile, toWardrobeGap,
} from "../services/mappers";
import { actions, type WearWiseAction } from "./actions";
import {
  computeAnalytics, computeStyleDNA, deriveInsights,
} from "./selectors";
import { initialState, wearWiseReducer, type WearWiseState } from "./wearWiseReducer";

export interface WearWiseContextValue {
  state: WearWiseState;
  dispatch: Dispatch<WearWiseAction>;
  /** Selector-derived, recomputed whenever the wardrobe/outfits change. */
  analytics: WardrobeAnalytics;
  insights: WardrobeInsight[];
  styleDNA: StyleDNA | null;
  /** True while the core wardrobe query is in flight (brief §23). */
  wardrobeLoading: boolean;
  wardrobeError: boolean;
}

const WearWiseContext = createContext<WearWiseContextValue | null>(null);

export function useWearWise(): WearWiseContextValue {
  const ctx = useContext(WearWiseContext);
  if (!ctx) throw new Error("useWearWise must be used inside <WearWiseProvider>");
  return ctx;
}

/** Optional variant for components that can render outside the provider
    (e.g. the landing page before sign-in hydrates anything). */
export function useWearWiseOptional(): WearWiseContextValue | null {
  return useContext(WearWiseContext);
}

function loadPreferences(): UserPreferences {
  const saved = storageService.getJSON<Partial<UserPreferences>>(STORAGE_KEYS.preferences);
  return saved ? { ...EMPTY_PREFERENCES, ...saved } : { ...EMPTY_PREFERENCES };
}

export function WearWiseProvider({
  user,
  children,
}: {
  user: { id: number; name: string; email: string } | null;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(wearWiseReducer, initialState, (init) => ({
    ...init,
    preferences: loadPreferences(),
  }));
  const userId = user?.id ?? null;

  /* ---- the core queries: fetched once here, shared by every screen ---- */
  const itemsQ = useQuery({
    queryKey: ["items", userId],
    queryFn: () => api.listItems({ userId: userId! }),
    enabled: userId !== null,
  });
  const savedQ = useQuery({
    queryKey: ["saved", userId],
    queryFn: () => api.listSavedOutfits({ userId: userId! }),
    enabled: userId !== null,
  });
  const analysesQ = useQuery({
    queryKey: ["analyses", userId],
    queryFn: () => api.listAnalyses({ userId: userId!, limit: 6 }),
    enabled: userId !== null,
  });
  const productsQ = useQuery({
    queryKey: ["products", userId],
    queryFn: () => api.recommendProducts({ userId: userId! }),
    enabled: userId !== null,
  });
  const gapsQ = useQuery({
    queryKey: ["gaps", userId],
    queryFn: () => api.getWardrobeGaps({ userId: userId! }),
    enabled: userId !== null,
  });
  const dnaQ = useQuery({
    queryKey: ["dna-base", userId],
    queryFn: () => api.getStyleProfile({ userId: userId! }),
    enabled: userId !== null,
  });

  /* ---- hydration: server truth → shared models → store ---- */
  useEffect(() => {
    if (!user) {
      dispatch(actions.setUser(null));
      return;
    }
    dispatch(actions.setUser(toUserProfile(user, state.styleDNA)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.name, user?.email]);

  useEffect(() => {
    if (userId === null || !itemsQ.data) return;
    dispatch(actions.hydrateWardrobe(itemsQ.data.items.map((row) => toClothingItem(row, userId))));
  }, [itemsQ.data, userId]);

  useEffect(() => {
    if (userId === null || !savedQ.data) return;
    dispatch(actions.hydrateOutfits(savedQ.data.outfits.map((row) => toSavedOutfit(row, userId))));
  }, [savedQ.data, userId]);

  useEffect(() => {
    if (userId === null || !analysesQ.data) return;
    dispatch(actions.hydrateAnalyses(analysesQ.data.analyses.map((row) => toPurchaseAnalysisRow(row, userId))));
  }, [analysesQ.data, userId]);

  useEffect(() => {
    if (!productsQ.data) return;
    dispatch(actions.hydrateProducts(productsQ.data.products.map(toProduct)));
  }, [productsQ.data]);

  useEffect(() => {
    if (userId === null || !gapsQ.data || !itemsQ.data) return;
    const wardrobe = itemsQ.data.items.map((row) => toClothingItem(row, userId));
    dispatch(actions.hydrateGaps(gapsQ.data.gaps.map((gap, i) => toWardrobeGap(gap, i, wardrobe))));
  }, [gapsQ.data, itemsQ.data, userId]);

  useEffect(() => {
    if (!dnaQ.data) return;
    dispatch(actions.hydrateStyleDNA(toStyleDNA(dnaQ.data)));
  }, [dnaQ.data]);

  /* Keep the profile's embedded StyleDNA + preference lists in sync —
     the profile model carries the same DNA object the screens use. */
  useEffect(() => {
    if (!user || !state.styleDNA) return;
    dispatch(actions.setUser(toUserProfile(user, state.styleDNA)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.styleDNA?.summary, state.styleDNA?.confidence]);

  /* Persist preferences through the storage service only (§20). */
  useEffect(() => {
    storageService.setJSON(STORAGE_KEYS.preferences, state.preferences);
  }, [state.preferences]);

  /* Reset per-user slices when the session ends. */
  useEffect(() => {
    if (userId === null) dispatch(actions.resetSession());
  }, [userId]);

  const analytics = useMemo(() => computeAnalytics(state), [state.wardrobe, state.outfits]);
  const insights = useMemo(() => deriveInsights(state), [state.wardrobe, state.wardrobeGaps]);
  const styleDNA = useMemo(() => computeStyleDNA(state, state.styleDNA), [state.wardrobe, state.styleDNA]);

  const value = useMemo<WearWiseContextValue>(() => ({
    state,
    dispatch,
    analytics,
    insights,
    styleDNA,
    wardrobeLoading: itemsQ.isPending && userId !== null,
    wardrobeError: itemsQ.isError,
  }), [state, analytics, insights, styleDNA, itemsQ.isPending, itemsQ.isError, userId]);

  return <WearWiseContext.Provider value={value}>{children}</WearWiseContext.Provider>;
}
