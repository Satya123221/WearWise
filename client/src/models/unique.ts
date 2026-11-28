/* Models for the five Unique Edge features. All five read the same
   shared wardrobe the rest of WearWise uses — these types only add the
   feature-level shapes (wear context, challenge progress, resale
   estimates, tomorrow plans, colour season) on top of the wardrobe
   item / outfit wire shapes every screen already renders. Computed
   server-side in server/src/actions.ts over the user's real rows. */

import type { ApiResponse } from "../api";
import type { api } from "../api";

export type UniqueItem = ApiResponse<typeof api, "listItems">["items"][number];
export type UniqueOutfit = ApiResponse<typeof api, "generateOutfit">["outfit"];

/** Repeat Radar — one outfit actually worn, with who saw it. */
export interface WearLogEntry {
  id: number;
  occasion: string;
  audience: string;
  location: string;
  wornAt: string; // ISO instant
  daysAgo: number;
  items: UniqueItem[];
}

export interface RepeatWarning {
  audience: string;
  occasion: string;
  daysAgo: number;
  risk: string; // "High" | "Medium"
  message: string;
  itemNames: string[];
}

export interface RepeatCheck {
  isRepeat: boolean;
  message: string;
  daysAgo: number | null;
}

export interface RepeatRadar {
  history: WearLogEntry[];
  warnings: RepeatWarning[];
  audiences: string[];
  trackedWears: number;
  check: RepeatCheck | null;
}

/** One Item, 7 Ways — seven anchored outfits + the 30-day challenge. */
export interface SevenWays {
  item: UniqueItem | null;
  candidates: Array<{ item: UniqueItem; daysSince: number }>;
  outfits: Array<{ label: string; occasion: string; outfit: UniqueOutfit }>;
}

export interface ItemChallenge {
  id: number;
  item: UniqueItem;
  startedAt: string;
  targetDays: number;
  targetWears: number;
  wearsLogged: number;
  streak: number;
  daysElapsed: number;
  daysLeft: number;
  status: string;
  progressPct: number;
}

/** Dead Stock to Cash — an unworn piece, its locked ₹ and resale estimate. */
export interface DeadStockEntry {
  item: UniqueItem;
  daysUnworn: number | null; // null = never worn
  tier: string; // "Dead stock" | "Going stale" | "Sleeping"
  lockedValue: number;
  resaleEstimate: number; // heuristic estimate, labelled as such in UI
  resalePct: number;
  action: string; // "Sell" | "Donate" | "Style it first"
  reason: string;
}

export interface DeadStock {
  items: DeadStockEntry[];
  totalLocked: number;
  totalResale: number;
  deadCount: number;
  staleCount: number;
  neverWornCount: number;
}

/** Tomorrow, Laid Out — tonight's saved plan for tomorrow. */
export interface TomorrowWeather {
  temp: number;
  condition: string;
  advice: string;
}

export interface TomorrowPlanData {
  date: string; // YYYY-MM-DD the outfit is FOR
  weather: TomorrowWeather;
  plan: { occasion: string; note: string; outfit: UniqueOutfit } | null;
}

/* ---- Second wave (2026-11-28) — types ride the action contracts --- */

export type SwapCircle = ApiResponse<typeof api, "getSwapCircle">;
export type SwapLoan = SwapCircle["active"][number];
export type WashCoach = ApiResponse<typeof api, "getWashCoach">;
export type WashEntry = WashCoach["items"][number];
export type RunwayPlanData = ApiResponse<typeof api, "getRunwayPlans">["plans"][number];
export type StyleTimeMachine = ApiResponse<typeof api, "getStyleTimeMachine">;
export type NoBuyState = ApiResponse<typeof api, "getNoBuyChallenge">;
export type RewearImpact = ApiResponse<typeof api, "getRewearImpact">;

/** Your Colour Season — a palette derived from owned/worn colours. */
export interface ColourSeason {
  season: string; // Spring | Summer | Autumn | Winter
  tagline: string;
  undertone: string;
  depth: string;
  confidence: number; // 0–100, grows with wardrobe size + wear data
  palette: Array<{ name: string; hex: string; owned: boolean; note: string }>;
  avoid: Array<{ name: string; hex: string; owned: boolean; reason: string }>;
  ownedColors: Array<{ name: string; hex: string; count: number; wears: number }>;
  guidance: string[];
}
