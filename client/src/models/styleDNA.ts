/* StyleDNA — one object, shared by dashboard, AI stylist, Smart Shop and
   profile (brief §6). The six canonical affinities come from the server's
   getStyleProfile; sporty/trendy are derived from the same wardrobe rows
   by the selector layer (selectors.computeStyleDNA). Scores are 0–100
   affinities, not shares — they do not need to sum to 100. */

export interface StyleDNA {
  minimal: number;
  casual: number;
  smartCasual: number;
  streetwear: number;
  classic: number;
  sporty: number;
  traditional: number;
  trendy: number;
  preferredColors: string[];
  preferredFits: string[];
  preferredOccasions: string[];
  /** 0–1 confidence in the profile, grows with feedback volume. */
  confidence: number;
  summary: string;
}

export const EMPTY_STYLE_DNA: StyleDNA = {
  minimal: 0, casual: 0, smartCasual: 0, streetwear: 0, classic: 0,
  sporty: 0, traditional: 0, trendy: 0,
  preferredColors: [], preferredFits: [], preferredOccasions: [],
  confidence: 0, summary: "",
};

/** The eight DNA dimensions in display order, keyed to the model. */
export const STYLE_DNA_DIMENSIONS: Array<{ key: keyof Pick<StyleDNA, "minimal" | "casual" | "smartCasual" | "streetwear" | "classic" | "sporty" | "traditional" | "trendy">; label: string }> = [
  { key: "minimal", label: "Minimal" },
  { key: "casual", label: "Casual" },
  { key: "smartCasual", label: "Smart Casual" },
  { key: "streetwear", label: "Streetwear" },
  { key: "classic", label: "Classic" },
  { key: "sporty", label: "Sporty" },
  { key: "traditional", label: "Traditional" },
  { key: "trendy", label: "Trendy" },
];
