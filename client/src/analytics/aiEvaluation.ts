/* AI Evaluation + Recommendation Analytics (§16, §17) — client mirror
   over the store; the server action getIntelligence computes the same
   metrics from the durable feedback/analyses/outfit tables. Rates are
   null with no data — an honest "not enough signal yet", never a
   fabricated percentage. */

import type { WearWiseState } from "../store/wearWiseReducer";
import type { AIEvaluationSummary } from "../models/intelligence";

export function computeEvaluation(state: WearWiseState): AIEvaluationSummary {
  const fb = state.outfitFeedback;
  const love = fb.filter((f) => f.feedbackType === "Love").length;
  const like = fb.filter((f) => f.feedbackType === "Like").length;
  const dislike = fb.filter((f) => f.feedbackType === "Dislike").length;
  const rated = love + like + dislike + fb.filter((f) => f.feedbackType === "Neutral").length;
  const pct = (n: number) => (rated ? Math.round((n / rated) * 100) : null);
  return {
    totalSignals: fb.length,
    accepted: love + like,
    rejected: dislike,
    loveRate: pct(love),
    dislikeRate: pct(dislike),
    saveRate: null,
    wearRate: null,
    buyAnalyses: state.purchaseAnalyses.length,
    outfitsSaved: state.outfits.length,
    packingPlans: state.packingPlans.length,
    topFeature: state.purchaseAnalyses.length >= state.outfits.length ? "Buy / Skip" : "AI Stylist",
    weakestFeature: rated === 0 ? "Not enough feedback yet to rank features" : "—",
  };
}

/** Recommendation analytics (§17): feature-usage counts from state. */
export function computeUsageCounts(state: WearWiseState): Array<{ label: string; count: number }> {
  return [
    { label: "Outfits saved", count: state.outfits.length },
    { label: "Feedback signals", count: state.outfitFeedback.length },
    { label: "Buy/Skip analyses", count: state.purchaseAnalyses.length },
    { label: "Packing plans", count: state.packingPlans.length },
    { label: "Wardrobe gaps tracked", count: state.wardrobeGaps.length },
  ];
}
