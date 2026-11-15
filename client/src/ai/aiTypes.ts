/* AI provider abstraction (§27, §28) — the UI and services depend on
   these interfaces only, never on a concrete provider. Today the one
   implementation is the deterministic mock/deterministic provider
   backed by the server actions (Mock AI / Future API Ready); a real
   vision or LLM provider implements the same surface later. */

export interface ClothingAnalysisGuess {
  name: string;
  category: string;
  color: string;
  pattern: string;
  material: string;
  style: string;
  fit: string;
  season: string;
  formality: number;
  price: number;
}

export interface AIProvider {
  readonly name: string;
  readonly kind: "mock-deterministic" | "llm" | "vision" | "future";
  /** Future CV seam (§27): image classification / detection / embeddings
      slot in here. The current provider returns the server's starting
      guess; a vision provider would read the image bytes instead. */
  analyzeClothingImage(input: { hint: string; sampleIndex: number }): Promise<ClothingAnalysisGuess | null>;
}
