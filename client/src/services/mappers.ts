/* Mappers — the single translation point between the server action
   contract (api.ts response types) and the shared client models.
   Every feature consumes models; only this file (and the services)
   know the wire shape, so a server contract change touches one place. */

import { api, type ApiResponse } from "../api";
import type {
  ClothingItem, ClothingSlot, Outfit, Product, PurchaseAnalysis, StyleDNA, WardrobeGap,
} from "../models";
import { EMPTY_PREFERENCES, SLOT_TO_CATEGORY, type UserProfile } from "../models";
import { deriveAiAttributes, getOccasionsForFormality } from "../store/selectors";

export type ApiItem = ApiResponse<typeof api, "listItems">["items"][number];
export type ApiOutfit = ApiResponse<typeof api, "generateOutfit">["outfit"];
export type ApiSavedOutfit = ApiResponse<typeof api, "listSavedOutfits">["outfits"][number];
export type ApiProduct = ApiResponse<typeof api, "recommendProducts">["products"][number];
export type ApiAnalysis = ApiResponse<typeof api, "analyzePurchase">["analysis"];
export type ApiAnalysisRow = ApiResponse<typeof api, "listAnalyses">["analyses"][number];
export type ApiStyleProfile = ApiResponse<typeof api, "getStyleProfile">;
export type ApiGap = ApiResponse<typeof api, "getWardrobeGaps">["gaps"][number];

const SLOTS: ClothingSlot[] = ["top", "bottom", "shoes", "outerwear", "accessory", "ethnic"];
function asSlot(slot: string): ClothingSlot {
  return (SLOTS as string[]).includes(slot) ? (slot as ClothingSlot) : "top";
}

export function toClothingItem(row: ApiItem, userId: number): ClothingItem {
  const slot = asSlot(row.slot);
  const base: Omit<ClothingItem, "aiAttributes"> = {
    id: row.id,
    userId,
    name: row.name,
    category: SLOT_TO_CATEGORY[slot],
    subcategory: row.category,
    slot,
    image: row.imageKey,
    color: row.color,
    colorHex: row.colorHex,
    secondaryColors: [],
    pattern: row.pattern,
    material: row.material,
    fit: row.fit,
    style: [row.style],
    season: [row.season],
    occasions: row.occasions.length ? row.occasions : getOccasionsForFormality(row.formality),
    formality: row.formality,
    brand: row.brand,
    retailer: row.retailer,
    productUrl: row.productUrl,
    purchasePrice: row.price,
    mrp: row.mrp,
    purchaseDate: null,
    timesWorn: row.wornCount,
    lastWorn: row.lastWornAt,
    favorite: row.favorite,
    tags: [row.category, row.style].filter(Boolean),
  };
  return { ...base, aiAttributes: deriveAiAttributes(base) };
}

export function toOutfit(row: ApiOutfit, userId: number, ctx: { occasion?: string; weather?: string; style?: string } = {}): Outfit {
  const factor = (label: string) => row.factors.find((f) => f.label === label)?.score ?? row.matchScore;
  return {
    id: null,
    userId,
    name: row.title,
    itemIds: row.items.map((i) => i.id),
    occasion: ctx.occasion ?? row.title.split(" — ")[0] ?? "",
    weather: ctx.weather ?? "",
    style: ctx.style ?? row.title.split(" — ")[1] ?? "",
    matchScore: row.matchScore,
    colorScore: factor("Color harmony"),
    occasionScore: factor("Occasion match"),
    weatherScore: factor("Weather suitability"),
    styleScore: factor("Style compatibility"),
    versatilityScore: factor("Versatility"),
    explanation: row.explanation,
    createdAt: null,
    favorite: false,
    worn: false,
  };
}

export function toSavedOutfit(row: ApiSavedOutfit, userId: number): Outfit {
  return {
    id: row.id,
    userId,
    name: row.title,
    itemIds: row.items.map((i) => i.id),
    occasion: row.occasion,
    weather: "",
    style: "",
    matchScore: row.matchScore,
    colorScore: row.matchScore,
    occasionScore: row.matchScore,
    weatherScore: row.matchScore,
    styleScore: row.matchScore,
    versatilityScore: row.matchScore,
    explanation: row.explanation,
    createdAt: null,
    favorite: false,
    worn: false,
  };
}

export function toProduct(row: ApiProduct): Product {
  return {
    id: row.id,
    name: row.name,
    image: row.imageKey,
    brand: row.brand,
    category: row.category,
    slot: "",
    color: row.color,
    colorHex: row.colorHex,
    style: "",
    price: row.price,
    mrp: row.mrp,
    currency: "INR",
    source: row.retailer,
    productUrl: row.productUrl,
    rating: null,
    match: row.match,
    note: row.note,
  };
}

export function toPurchaseAnalysis(row: ApiAnalysis, userId: number): PurchaseAnalysis {
  return {
    id: row.id,
    userId,
    productId: null,
    productName: row.productName,
    price: row.price,
    mrp: row.mrp,
    verdict: (["BUY", "CONSIDER", "SKIP"].includes(row.verdict) ? row.verdict : "CONSIDER") as PurchaseAnalysis["verdict"],
    wardrobeValue: row.score,
    duplicateScore: row.duplicateScore,
    versatilityScore: row.versatilityScore,
    compatibilityScore: row.compatibilityScore,
    wardrobeImpact: row.wardrobeImpact,
    matchingItemIds: [],
    similarItemIds: [],
    reasons: row.reasons,
    cautions: row.cautions,
    aiSummary: row.verdictText,
    projectedOutfits: row.projectedOutfits,
    projectedCostPerWear: row.projectedCostPerWear,
    createdAt: null,
  };
}

export function toPurchaseAnalysisRow(row: ApiAnalysisRow, userId: number): PurchaseAnalysis {
  return {
    id: row.id,
    userId,
    productId: null,
    productName: row.productName,
    price: row.price,
    mrp: row.mrp,
    verdict: (["BUY", "CONSIDER", "SKIP"].includes(row.verdict) ? row.verdict : "CONSIDER") as PurchaseAnalysis["verdict"],
    wardrobeValue: row.score,
    duplicateScore: null,
    versatilityScore: null,
    compatibilityScore: null,
    wardrobeImpact: row.verdictText,
    matchingItemIds: [],
    similarItemIds: [],
    reasons: [],
    cautions: [],
    aiSummary: row.verdictText,
    projectedOutfits: null,
    projectedCostPerWear: null,
    createdAt: row.createdAt,
  };
}

export function toStyleDNA(profile: ApiStyleProfile): StyleDNA {
  const pct = (label: string) => profile.styles.find((s) => s.label === label)?.pct ?? 0;
  return {
    minimal: pct("Minimal"),
    casual: pct("Casual"),
    smartCasual: pct("Smart Casual"),
    streetwear: pct("Streetwear"),
    classic: pct("Classic"),
    sporty: 0, // filled by selectors.computeStyleDNA from wardrobe rows
    traditional: pct("Traditional"),
    trendy: 0, // filled by selectors.computeStyleDNA from wardrobe rows
    preferredColors: profile.colors.map((c) => c.name),
    preferredFits: [profile.fit],
    preferredOccasions: profile.occasions,
    confidence: Math.min(0.95, 0.35 + profile.feedbackCount * 0.04),
    summary: profile.summary,
  };
}

export function toWardrobeGap(gap: ApiGap, index: number, wardrobe: ClothingItem[]): WardrobeGap {
  return {
    id: `gap-${index}-${gap.category.toLowerCase().replace(/\s+/g, "-")}`,
    category: gap.category,
    itemType: gap.title,
    priority: gap.potentialCombos >= 12 ? "High" : gap.potentialCombos >= 6 ? "Medium" : "Low",
    reason: gap.reason,
    potentialOutfitCount: gap.potentialCombos,
    matchingExistingItemIds: wardrobe.filter((i) => i.slot !== gap.slot).map((i) => i.id),
    recommended: index === 0,
  };
}

export function toUserProfile(
  profile: { id: number; name: string; email: string },
  styleDNA: StyleDNA | null,
): UserProfile {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    avatar: null,
    age: null,
    preferredStyles: styleDNA
      ? Object.entries({
          Minimal: styleDNA.minimal, Casual: styleDNA.casual, "Smart Casual": styleDNA.smartCasual,
          Streetwear: styleDNA.streetwear, Classic: styleDNA.classic, Traditional: styleDNA.traditional,
        }).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([label]) => label)
      : [],
    preferredColors: styleDNA?.preferredColors ?? [],
    preferredFits: styleDNA?.preferredFits ?? [],
    favoriteOccasions: styleDNA?.preferredOccasions ?? [],
    styleDNA,
    preferences: { ...EMPTY_PREFERENCES },
    styleNotes: "",
  };
}
