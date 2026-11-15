# WearWise AI Architecture

How the AI works today, what is mock, and exactly where real models
plug in later. Rule: **never claim a feature is smarter than it is.**

## Status per feature

| Feature | Status | How it works |
| --- | --- | --- |
| Outfit Generator | Deterministic engine + personalization | 5-factor scoring (colour, occasion, weather, style, versatility) with a taste bias from stored ratings; ships score + confidence + reasons |
| Style DNA | Deterministic derivation | Wear-weighted affinities from wardrobe rows + feedback; recalculates on read |
| Preference Engine | Live learning | Signals (love/like/worn/saved + reasoned feedback) → 0–1 weights for colours, styles, fits; avoided maps from “not my style” |
| Buy / Skip | Deterministic engine | Verdict + compatibility / versatility / duplicate / impact breakdown + **Wardrobe ROI** + **confidence** |
| Duplicate Detector | Deterministic similarity | Category/colour/pattern/style/fit overlap vs owned pieces |
| What If I Bought This? | Deterministic simulation | Real outfits the candidate joins, counted from owned rows |
| Smart Shopping | Real catalogue + engine | Meta Catalog products scored against gaps, duplicates and Style DNA |
| Wardrobe ROI | Deterministic derivation | Per-piece: pairings, compatible items/occasions, versatility, wear frequency, duplicate risk, cost-per-wear |
| Wardrobe Health | Deterministic derivation | 9 dimensions (versatility, usage, category balance, occasion coverage, duplication, unused, colour balance, outfit potential, cost efficiency), averaged, weakest dimension explained |
| Gap Analysis | Deterministic derivation | Gaps claimed only when genuinely missing; combinations counted from real rows |
| AI Insight Feed | Deterministic derivation | Every line computed from rows (stale pieces, versatile anchors, colour overload, best value) |
| Style Evolution | Deterministic derivation | Per-month dominant style from that month's stored feedback; empty months are never invented |
| AI Evaluation | Deterministic derivation | Acceptance/love/dislike/save/wear rates from the feedback table; null rates until data exists |
| Ask WearWise | Intent router (Mock AI / Future LLM Ready) | Routes to the real engines: outfit, purchase, gaps, packing, ROI, health, evolution, Repeat Radar… |
| Weather Stylist | **Mock AI / demo reading** | Fixed demo weather behind the `weatherService` seam, labelled in UI |
| Clothing scan | **Mock AI / Future Vision Ready** | Filename/sample-based starting guess, fully editable, no confidence % shown |
| Snap & Style | **Mock AI / Future Vision Ready** | Score + suggestions anchored on owned items |
| Pack Smart | Deterministic engine | Capsule from owned pieces; unowned essentials flagged |

## AI provider abstraction (§27, §28)

```text
AIProvider (client/src/ai/aiTypes.ts)
├── MockAIProvider — LIVE: deterministic server actions
│     (client/src/ai/providers.ts → createMockAIProvider)
├── LLMProvider — seam only: would call a server-side LLM action;
│     keys never enter the client bundle
└── VisionProvider — seam only: analyzeClothingImage(image) is the
      integration point for classification / detection / CLIP
      embeddings / background removal
```

The UI depends on the interface and on `aiService`, never on a
provider directly, so swapping the mock for a real model changes one
file, not the product.

## AI response safety (§29)

```text
Provider response → validateClothingGuess (shape, ranges, lengths)
  → sanitized object → UI
  → invalid/missing → null → graceful fallback (manual form, honest
    empty state) — the UI never crashes on a malformed AI response
```

Server actions additionally validate every request and response with
Zod schemas at the action boundary.

## Confidence honesty (§9)

Confidence = wardrobe depth (≤30) + feedback depth (≤25) + attribute
completeness (≤25) + subject known (≤20). A new user with three pieces
and no ratings gets a low number and a label that says why — the
system never dresses a guess up as certainty.

## The personalization loop (§6) — verified behaviour

1. User rates an outfit (optionally with a reason).
2. `recordDetailedFeedback` stores kind + detail (reason embedded).
3. `computePreferenceWeights` re-derives weights on next read.
4. `generateOutfit`'s taste bias: loved styles +9, disliked −12 in
   pick scoring — future recommendations measurably change.
5. Style DNA's learned line and the Intelligence hub's weights make
   the change visible to the user.

## Future integration points (Tier 4 — do not build before Tier 1–3 are stable)

- **Computer vision / CLIP / YOLO** → `AIProvider.analyzeClothingImage`
  and Snap & Style's scoring action.
- **LLM** → Ask WearWise's intent router is the seam; keep prompts and
  structured output inside a server action.
- **Weather API** → `weatherService` / `getWeatherOutfit`.
- **Product APIs / affiliate feeds** → the `Product` model is
  source-agnostic; Smart Shop's scoring does not change.
- **Firebase** → `storageService` is the client seam; durable data is
  already server-side behind typed actions.
- **Virtual try-on / wardrobe video scanning** → new actions behind
  the existing service layer.
