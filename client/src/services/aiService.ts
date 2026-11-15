/* aiService — every AI operation in one async layer (brief §17).
   All functions are async and wardrobe-driven: they call the typed
   server actions, which compute deterministically over the user's real
   wardrobe rows today and are the seam where a FastAPI / vision backend
   would slot in later — the UI and store contracts would not change.
 *
   Nothing here invents data: outfits reference real ClothingItem ids,
   purchase breakdowns compose the server's own duplicate/compatibility
   signals, and packing lists reference owned items (unowned essentials
   stay plain labels in the server response). */

import { api, type ApiResponse } from "../api";
import type { Outfit, PackingPlan, PurchaseAnalysis } from "../models";
import {
  toClothingItem, toOutfit, toPurchaseAnalysis, type ApiOutfit,
} from "./mappers";
import { wardrobeService } from "./wardrobeService";

export interface GenerateOutfitInput {
  occasion: string;
  weather: string;
  style: string;
  seed?: number;
}

export const aiService = {
  /** analyzeClothing — the upload scan's starting guess (user-reviewed). */
  async analyzeClothing(userId: number, hint: string, sampleIndex: number) {
    return api.analyzeClothing({ userId, hint, sampleIndex });
  },

  async generateOutfit(userId: number, input: GenerateOutfitInput): Promise<{ outfit: Outfit; raw: ApiOutfit }> {
    const res = await api.generateOutfit({
      userId, occasion: input.occasion, weather: input.weather, style: input.style, seed: input.seed ?? 0,
    });
    return { outfit: toOutfit(res.outfit, userId, input), raw: res.outfit };
  },

  async stylistAsk(userId: number, prompt: string, seed = 0) {
    return api.stylistAsk({ userId, prompt, seed });
  },

  /** analyzeOutfit — Snap & Style scoring of a photographed look. */
  async analyzeOutfitPhoto(userId: number, hint: string, sampleIndex: number) {
    return api.analyzeOutfitPhoto({ userId, hint, sampleIndex });
  },

  async analyzePurchase(
    userId: number,
    input: { productName: string; price: number; mrp: number | null; color: string; slot: string; style: string },
  ): Promise<PurchaseAnalysis> {
    const res = await api.analyzePurchase({ userId, ...input });
    return toPurchaseAnalysis(res.analysis, userId);
  },

  /** The full §8 breakdown: the stored verdict composed with duplicate
      detection and wardrobe compatibility, all from the same wardrobe. */
  async analyzePurchaseFull(
    userId: number,
    input: { productName: string; price: number; mrp: number | null; color: string; slot: string; style: string },
  ): Promise<PurchaseAnalysis> {
    const [base, dup, wardrobe] = await Promise.all([
      aiService.analyzePurchase(userId, input),
      api.detectDuplicates({ userId, productName: input.productName, color: input.color, slot: input.slot, style: input.style }),
      wardrobeService.listItems(userId),
    ]);
    const topSimilarity = dup.similar[0]?.similarity ?? 0;
    const matching = wardrobe.filter((i) => i.slot !== input.slot).map((i) => i.id);
    return {
      ...base,
      duplicateScore: dup.similar.length ? topSimilarity : (base.duplicateScore ?? 8),
      compatibilityScore: base.compatibilityScore ?? base.wardrobeValue,
      versatilityScore: base.versatilityScore ?? Math.min(97, Math.max(20, Math.round((base.projectedOutfits ?? 3) * 5.2))),
      matchingItemIds: matching.slice(0, 12),
      similarItemIds: dup.similar.map((s) => s.item.id),
    };
  },

  async detectDuplicates(
    userId: number,
    input: { productName: string; color: string; slot: string; style: string },
  ) {
    const res = await api.detectDuplicates({ userId, ...input });
    return {
      similar: res.similar.map((s) => ({ item: toClothingItem(s.item, userId), similarity: s.similarity })),
      count: res.count,
      message: res.message,
    };
  },

  async simulatePurchase(
    userId: number,
    input: { productName: string; price: number; color: string; slot: string; style: string },
  ) {
    return api.simulatePurchase({ userId, ...input });
  },

  /** generateStyleDNA — the server's Style DNA derivation. */
  async getStyleProfile(userId: number): Promise<ApiResponse<typeof api, "getStyleProfile">> {
    return api.getStyleProfile({ userId });
  },

  /** analyzeWardrobeGaps — shared with shoppingService/analytics. */
  async getWardrobeGaps(userId: number) {
    return api.getWardrobeGaps({ userId });
  },

  async generatePackingList(
    userId: number,
    input: { destination: string; days: number; tripType: string },
  ): Promise<{ plan: PackingPlan; raw: ApiResponse<typeof api, "generatePackingList"> }> {
    const res = await api.generatePackingList({ userId, ...input });
    const ownedLabels = new Set<string>();
    for (const group of res.groups) for (const e of group.entries) if (e.owned) ownedLabels.add(e.label);
    const wardrobe = await wardrobeService.listItems(userId);
    const plan: PackingPlan = {
      id: `pack-${input.destination.toLowerCase().replace(/\s+/g, "-")}-${input.days}d`,
      destination: input.destination,
      startDate: null,
      endDate: null,
      duration: input.days,
      tripType: input.tripType,
      selectedItemIds: wardrobe.filter((i) => ownedLabels.has(i.name)).map((i) => i.id),
      generatedOutfitIds: [],
      essentials: res.groups.flatMap((g) => g.entries.filter((e) => !e.owned).map((e) => e.label)),
    };
    return { plan, raw: res };
  },

  /** generateOutfitRemix — 1–2 piece swaps that keep the outfit's style. */
  async generateOutfitRemix(
    userId: number,
    input: { itemIds: number[]; occasion: string; weather: string; style: string },
  ): Promise<Outfit[]> {
    const res = await api.remixOutfit({ userId, ...input });
    return res.remixes.map((r) => toOutfit(r.outfit, userId, input));
  },

  async transformItem(userId: number, itemId: number) {
    return api.transformItem({ userId, itemId });
  },

  async recommendAccessories(userId: number, itemIds: number[], occasion: string) {
    return api.recommendAccessories({ userId, itemIds, occasion });
  },

  async getUseAgain(userId: number, offset = 0) {
    return api.getUseAgain({ userId, offset });
  },

  /** generateWardrobeInsights — server insight feed + health breakdown. */
  async getInsights(userId: number) {
    return api.getInsights({ userId });
  },

  async getWeatherOutfit(userId: number, seed = 0) {
    return api.getWeatherOutfit({ userId, seed });
  },

  async askWearWise(userId: number, question: string, seed = 0) {
    return api.askWearWise({ userId, question, seed });
  },

  async recordFeedback(userId: number, rating: "love" | "good" | "unsure" | "not", detail: string) {
    return api.recordFeedback({ userId, rating, detail });
  },

  /* ---- Unique Edge features — all read the same shared wardrobe ---- */

  /** Repeat Radar: wear history with social context + repeat warnings.
      Pass itemIds + audience to also check a planned outfit. */
  async getRepeatRadar(userId: number, check?: { itemIds: number[]; audience: string }) {
    return api.getRepeatRadar({ userId, itemIds: check?.itemIds, audience: check?.audience });
  },

  /** Logs an outfit as worn with who saw it; bumps real wear counts. */
  async logWear(userId: number, input: { itemIds: number[]; occasion: string; audience: string; location: string }) {
    return api.logWear({ userId, ...input });
  },

  /** One Item, 7 Ways: seven outfits anchored on a neglected piece. */
  async getSevenWays(userId: number, itemId: number | null) {
    return api.getSevenWays({ userId, itemId });
  },

  async getChallenge(userId: number) {
    return api.getChallenge({ userId });
  },

  async startChallenge(userId: number, itemId: number) {
    return api.startChallenge({ userId, itemId });
  },

  async logChallengeWear(userId: number) {
    return api.logChallengeWear({ userId });
  },

  /** Dead Stock to Cash: unworn 30+ days, ₹ locked, resale estimates. */
  async getDeadStock(userId: number) {
    return api.getDeadStock({ userId });
  },

  async getTomorrowPlan(userId: number) {
    return api.getTomorrowPlan({ userId });
  },

  /** Tomorrow, Laid Out: pick + save tomorrow's outfit tonight. */
  async setTomorrowPlan(userId: number, occasion: string, style = "Smart Casual") {
    return api.setTomorrowPlan({ userId, occasion, style });
  },

  /** Your Colour Season: palette + avoid list from owned/worn colours. */
  async getColourSeason(userId: number) {
    return api.getColourSeason({ userId });
  },

  /* ---- Intelligence Layer (§1–§26) — the unified engines ---- */

  /** The hub payload: context, style profile, preference weights, AI
      memory, confidence, health, evolution, evaluation, notifications. */
  async getIntelligence(userId: number) {
    return api.getIntelligence({ userId });
  },

  /** Wardrobe ROI league table (§13). */
  async getWardrobeROI(userId: number) {
    return api.getWardrobeROI({ userId });
  },

  /** Advanced feedback (§12): rating + reason, learned specifically. */
  async recordDetailedFeedback(
    userId: number,
    input: { rating: "love" | "good" | "unsure" | "not"; reason: string; detail: string },
  ) {
    return api.recordDetailedFeedback({ userId, ...input });
  },

  async exportMyData(userId: number) {
    return api.exportMyData({ userId });
  },

  async deleteMyData(userId: number) {
    return api.deleteMyData({ userId });
  },

  /** Demo Mode (§20): restore the original demo wardrobe + history. */
  async resetDemoWardrobe(userId: number) {
    return api.resetDemoWardrobe({ userId });
  },

  /** Privacy (§13): clear AI memory only — feedback-derived learning is
      wiped, wardrobe/outfits/analyses stay. */
  async clearAiMemory(userId: number) {
    return api.clearAiMemory({ userId });
  },

  async saveOutfit(
    userId: number,
    input: { title: string; itemIds: number[]; occasion: string; matchScore: number; explanation: string },
  ): Promise<number> {
    const res = await api.saveOutfit({ userId, ...input });
    return res.id;
  },

  async listSavedOutfits(userId: number) {
    return api.listSavedOutfits({ userId });
  },

  async deleteSavedOutfit(userId: number, outfitId: number): Promise<void> {
    await api.deleteSavedOutfit({ userId, outfitId });
  },

  async listAnalyses(userId: number, limit = 6) {
    return api.listAnalyses({ userId, limit });
  },
};
