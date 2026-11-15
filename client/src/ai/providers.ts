/* AI providers (§28, §29) — MockAIProvider is the live one: it calls
   the typed server actions (deterministic over the user's real rows)
   and validates every response before it can reach the UI. A malformed
   response degrades to null + a graceful fallback, never a crash.
   LLMProvider / VisionProvider are documented seams, not stubs that
   pretend to work — they are not selectable until a real backend lands. */

import { api } from "../api";
import type { AIProvider, ClothingAnalysisGuess } from "./aiTypes";

/** AI response safety (§29): validate → sanitize → fallback. */
export function validateClothingGuess(raw: unknown): ClothingAnalysisGuess | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 90) : fallback);
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const name = str(r.name, "");
  if (!name) return null; // a guess with no garment name is unusable — caller falls back
  return {
    name,
    category: str(r.category, "Shirt"),
    color: str(r.color, "Black"),
    pattern: str(r.pattern, "Solid"),
    material: str(r.material, "Cotton"),
    style: str(r.style, "Casual"),
    fit: str(r.fit, "Regular"),
    season: str(r.season, "All Season"),
    formality: Math.max(1, Math.min(5, Math.round(num(r.formality, 2)))),
    price: Math.max(0, num(r.price, 0)),
  };
}

export function createMockAIProvider(userId: number): AIProvider {
  return {
    name: "WearWise Deterministic Engine",
    kind: "mock-deterministic",
    async analyzeClothingImage(input) {
      try {
        const res = await api.analyzeClothing({ userId, hint: input.hint, sampleIndex: input.sampleIndex });
        // The action's contract names the guess `detected` and its price
        // `suggestedPrice` — normalize into the provider's shape here,
        // at the seam, so no consumer depends on wire naming.
        return validateClothingGuess({ ...res.detected, price: res.detected.suggestedPrice });
      } catch {
        return null; // graceful fallback — the add form stays fully manual
      }
    },
  };
}

/* Future providers (§27/§28) — integration points, intentionally not
   wired: LLMProvider would route Ask WearWise's free text through a
   server-side LLM action (keys never in the client); VisionProvider
   would replace analyzeClothing's starting guess with real image
   classification behind this same interface. */
export const FUTURE_PROVIDERS = ["LLMProvider (server-side, keys protected)", "VisionProvider (classification + embeddings)"] as const;
