# WearWise — Senior Technical Audit (2026-11-15)

Method: the real code was inspected, not the intended architecture —
`client/src/App.tsx` (3,888 lines), `server/src/actions.ts` (3,022 lines,
50 typed actions), schema + 7 migrations, models/store/services/
intelligence/ai/analytics layers. Typecheck: client and server both
clean under `strict` + `noUncheckedIndexedAccess`. Zero TODO/FIXME
markers in the codebase.

## System map

```text
User
 ↓
React client — 14 views in one App.tsx shell; WearWiseProvider
   (Context + useReducer) hydrates shared models from React Query
 ↓
Services (wardrobe / ai / shopping / weather / storage — the only
   localStorage gateway) → typed action client (api.ts)
 ↓
Server actions (50, all Zod-validated, all userId-scoped)
   Intelligence helpers: outfitFactors, computePreferenceWeights,
   confidenceFor, roiForItem, computeGaps
 ↓
SQLite via Drizzle — profiles · wardrobe_items · saved_outfits ·
   buy_analyses · feedback · wear_logs · item_challenges ·
   tomorrow_plans (user_id indexed as of migration 0007)
 ↓
External: Meta Catalog (build-time snapshot for the real branded
   seed/catalogue — no live external calls at runtime)
```

## WearWise Technical Health

```text
Overall Architecture:    7/10
Code Quality:            7/10
AI Architecture:         7/10
Recommendation Engine:   8/10
Security:                4/10
Performance:             7/10
UX:                      8/10
Mobile Readiness:        8/10
Scalability:             5/10
Startup Readiness:       6/10
```

## AI capability matrix (§4) — honest classification

| Feature | Class |
| --- | --- |
| Outfit Generator, Remix, Transformer, Weather Stylist picks | ALGORITHMIC INTELLIGENCE (5-factor deterministic scoring + feedback taste bias) |
| Style DNA, Preference weights, AI Memory | ALGORITHMIC INTELLIGENCE (derived from rows + feedback) |
| Buy/Skip, Duplicate Detector, What-If, Gap Analysis, ROI, Health, Insights, Dead Stock, Colour Season, Repeat Radar, 7 Ways | ALGORITHMIC INTELLIGENCE |
| Smart Shopping | ALGORITHMIC INTELLIGENCE over a real catalogue snapshot |
| Ask WearWise | ALGORITHMIC INTELLIGENCE (intent router over the real engines) |
| Clothing scan | MOCK AI — filename/sample starting guess, editable, no confidence shown (labelled) |
| Snap & Style | MOCK AI — scores anchored on owned items (labelled) |
| Weather reading | MOCK AI — fixed demo reading behind `weatherService` (labelled) |
| Real vision / LLM / embeddings | INCOMPLETE by design — provider seams exist (`ai/providers.ts`), Tier 4 |

No feature claims REAL AI. Nothing in the UI presents a mock as real.

## Feature completeness (§16, condensed)

READY (UI + logic + data + error states): Wardrobe CRUD, Outfit
Engine, Feedback loop, Style DNA, Analytics, Gaps, Buy/Skip,
Duplicates, What-If, Smart Shop, Packing, Repeat Radar, 7 Ways,
Dead Stock, Tomorrow Plan, Colour Season, Intelligence hub,
Export/Delete/Reset.
PARTIAL: Scan (mock guess — by design), Snap & Style (mock),
Weather (demo reading), Onboarding (checklist in Intelligence hub,
not a first-run wizard).
MOCK (labelled): scan, Snap & Style scoring, weather.
BROKEN: none found. MISSING: production auth, delete *account*
(data deletion exists; the profile row is kept), clear-AI-memory —
**added in this audit pass**.

## Critical issues

1. **Demo auth + client-supplied `userId` (IDOR-shaped).** Login is
   name + email; every action trusts the `userId` in its request.
   Anyone who can call the action endpoint can read/delete another
   account's wardrobe by incrementing an integer. This is the
   platform's demo pattern, acceptable for a personal demo, and the
   single blocker for real users. Fix path: verified session on the
   server, user id derived server-side, `userId` removed from action
   requests. NOT fixed in this pass — it changes every action
   signature and the client session model; doing it halfway (e.g. a
   client-stored token the client also supplies) would be theatre.
2. ~~`outfitCount` was partly invented~~ **FIXED in this pass.**
   `loadItems` added `min(14, wornCount/3)` to the real saved-outfit
   count and the result was displayed as "N outfit pairings" and fed
   ROI ("potential outfits"), insights ("anchors N pairings"),
   dead-stock copy and versatility scoring. Now counted from the
   rows: saved-outfit appearances + colour-compatible cross-slot
   pieces. Health's outfit-potential dimension, which multiplied the
   old count by an arbitrary 6, is now pairing coverage (avg
   pairings ÷ possible pairings).

## High priority issues

3. ~~No "Clear AI Memory / Reset personalization" control~~ **FIXED
   in this pass.** §13 requires it; only full data deletion existed.
   New `clearAiMemory` action deletes only `feedback` rows
   (preference weights, learned Style DNA line, Style Evolution and
   AI Memory all derive from that table, so they reset truthfully);
   wired through `aiService` with a confirm flow in the Intelligence
   hub's data section.
4. ~~Explanation Engine explained empty outfits~~ **FIXED in this
   pass.** `generateOutfit` on an empty wardrobe returned reasons
   claiming "Formality and pieces land right for {occasion}" for a
   zero-piece outfit. It now returns one honest reason naming what's
   missing (Journey 6).
5. ~~No indexes on `user_id`~~ **FIXED in this pass** (migration
   0007). Every query in the app filters by `user_id`; at 10k users
   × dozens of rows, unindexed scans on 7 tables would be the first
   database bottleneck.
6. **Two monolith files.** App.tsx (3,888 lines, 14 views + landing +
   shared components) and actions.ts (3,022 lines, 50 actions +
   engines + seed data). They typecheck and work, but they are the
   top maintainability risk: merge conflicts, slow review, and the
   reason small fixes touch giant files. Recommended split (views
   out of App.tsx; engines out of actions.ts) is mechanical and
   should be its own change, not bundled into a feature pass.
7. **Client/server engine duplication.** `client/src/intelligence/`
   mirrors server formulas (confidence, preference weights, health)
   so surfaces can render without a round-trip. The server is
   authoritative, but nothing mechanically prevents drift — the
   feedback-reason parsing bug fixed in the previous pass was
   exactly this failure mode. Mitigation today: formulas documented
   as mirrors in ARCHITECTURE.md. Real fix: generate the client
   engines from the server module or accept server-only numbers.

## Medium priority issues

8. **Scoring weights are literals, not configuration.** The brief's
   "keep scoring configurable" is half-met: client
   `scoringEngine.DEFAULT_WEIGHTS` exists, but the authoritative
   server blend in `outfitFactors` hardcodes 25/25/15/20/15.
9. **`loadItems` cost.** Every list-style action loads all wardrobe
   rows + all saved outfits and computes pairings in O(n²) over the
   wardrobe. Fine at demo scale (24–200 pieces); at 1,000+ pieces
   per user it needs the pairing count computed once per request
   (already the case) and eventually cached per wardrobe version.
10. **No rate limiting / observability.** No action throttling, no
    structured logging beyond the client error boundary. Acceptable
    for a single-user demo; required before public launch.
11. **Bundle is one file** (~787 KB HTML with inlined assets at last
    build). No route-level lazy loading; phone first paint pays for
    every view. Split by view when the monolith split (issue 6)
    happens.
12. **Delete account ≠ delete data.** `deleteMyData` keeps the
    profile row deliberately (so Reset Demo works); a true
    account-deletion flow is still missing for production.

## Low priority issues

13. Health dimensions use floor clamps (min 15–22) so a terrible
    wardrobe never scores near 0 — kind, but it compresses the
    scale's honesty at the bottom end.
14. `getIntelligence` evaluation counts packing plans as 0 because
    packing plans live in the client store, not the DB (known,
    documented previously).
15. Seed/catalogue prices are a dated snapshot (13 Nov 2026) —
    labelled in UI and DATA-PLAN.md; retailer pages carry live
    prices.

## Broken features

None found. All 50 actions respond; the §27/§36 flows were
re-verified against the sandbox in previous passes and the three
changed actions were re-verified in this pass (see DATA-PLAN.md).

## Mock features

Clothing scan (starting guess), Snap & Style scoring, weather
reading — all labelled in the UI, all behind provider seams.

## Missing features

Production auth (issue 1), account deletion (issue 12), real
vision/LLM/weather/product APIs (Tier 4, deliberately deferred).

## Technical debt

Monolith files (6), engine mirrors (7), literal weights (8),
floor-clamped health dimensions (13), one duplicated demo-log
seeding block (`login` and `resetDemoWardrobe` each inline the same
5 demo wear logs — extract when actions.ts is split).

## Security risks

Issue 1 (auth/IDOR) dominates. Otherwise: no secrets anywhere (no
API keys exist), all inputs Zod-validated with length/range caps,
no user HTML is rendered (React escaping + no `dangerouslySetInnerHTML`
in the client), uploaded photos are never stored (scan keeps no
bytes — file validation lands with the real vision provider),
Ask WearWise is an intent router, not an LLM, so prompt injection
has no model to inject into yet — that changes the day the LLM seam
is wired, and prompts must then be built server-side from validated
fields only.

## Performance risks

Issue 5 (fixed), issue 9, issue 11. Images are 3 owned WebP assets
(147–315 KB) — acceptable. React Query caches all reads; mutations
invalidate centrally.

## AI risks

The standing risk is honesty drift: any future "AI" surface must
ship score + confidence + reasons from the engines (the pattern
outfits and purchases already follow) and must not reintroduce
invented counts — issue 2 was exactly that failure, in miniature.

## Scalability (§18)

- **1,000 users:** works as-is. SQLite + per-user queries + indexes
  (now) handle this comfortably.
- **10,000 users:** auth (1) and rate limiting (10) become
  mandatory; `loadItems` pairing computation (9) needs caching;
  single-file SQLite write contention appears under concurrent
  wear-logging.
- **100,000 users:** move the DB to a hosted Postgres, wardrobe
  images (when real uploads land) to object storage with CDN,
  recommendation computation to cached per-user snapshots, and AI
  calls (when real) behind the one-analysis → stored-attributes →
  many-cheap-recommendations pattern already documented in
  AI_ARCHITECTURE.md. None of this needs building now.

## AI cost audit (§19)

Current AI cost is ₹0 — no external AI calls exist. The architecture
already follows the cheap pattern: one (future) expensive analysis
stored as structured attributes, all recommendations computed
deterministically from rows. The only repeated-computation waste is
`loadItems` re-deriving pairings per action call (issue 9).

## Recommended fix order

1. Production auth (issue 1) — before any real user data.
2. Monolith split (issue 6) — before the next feature wave.
3. Server scoring weights → shared config (issue 8) + engine-drift
   guard (issue 7).
4. Rate limiting + logging (issue 10), account deletion (issue 12).
5. Bundle splitting (issue 11) with the monolith split.
6. Tier 4 AI (vision → LLM → live weather/products), in that order,
   each behind its existing seam.

## Validation (§24 journeys, this pass)

- Journey 2/3/5 mechanics unchanged; the three changed server paths
  (pairing counts, empty-wardrobe outfit, clear-AI-memory) were
  exercised directly against the sandbox actions — see DATA-PLAN.md.
- Journey 6 (empty wardrobe): outfit generation now explains itself
  honestly; dashboard/wardrobe empty states already guide to Add.
- Journey 7 (API failure): root error boundary + per-view error
  states with recovery copy (verified in code; intelligence view,
  add-item and auth all surface actionable errors).
- Journey 8 (mobile): unchanged surfaces; the audit build's phone
  capture covers the new Clear AI Memory control.
- Journeys 1/4: unchanged code paths, covered by the audit build.
