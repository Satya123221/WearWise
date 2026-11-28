# WearWise Architecture

**Know what you own. Know what to wear. Know what to buy.**

A modular monolith — deliberately. One React client, one typed server
action layer, one database. No microservices, no event bus, no custom
ML infrastructure (§33 of the intelligence brief).

## System map

```text
                    USER
                     │
                     ▼
        React client (client/src/App.tsx)
        Views: Dashboard · Wardrobe · Add · AI Stylist · Snap & Style
               Buy/Skip · Smart Shop · Analytics · Pack Smart
               Unique Edge · Intelligence · Style DNA/Profile
                     │
        WearWiseProvider — React Context + useReducer (one store)
        models/ · store/ · services/ · intelligence/ · ai/ · analytics/
                     │  typed actions (client/src/api.ts)
                     ▼
        Server actions (server/src/actions.ts)
        Intelligence Layer engines (durable, over real rows)
                     │
                     ▼
        Database (server/src/schema.ts, drizzle/ migrations)
        profiles · wardrobe_items · saved_outfits · buy_analyses
        feedback · wear_logs · item_challenges · tomorrow_plans
```

## The Intelligence Layer

Every AI feature runs through the same engines instead of its own
logic. Server helpers in `server/src/actions.ts` are authoritative
(they read the durable rows); pure client mirrors in
`client/src/intelligence/` run over the shared store so any surface
can show the same numbers without a round-trip.

```text
                    WearWise Intelligence
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
   Context Engine    Style Engine     Preference Engine
   (focused context  (archetype,      (0–1 weights from
    builders)         colours, fits,   loves / wears /
                      formality…)      “not my style”)
          └─────────────────┼─────────────────┘
                            ▼
                   Recommendation Engine
                   recommend(type, context, …)
                            ▼
                      Scoring Engine
              (configurable weights, 0–100)
                            ▼
                 Confidence + Explanation
              (data-depth confidence; reasons
               built from the actual factors)
                            ▼
                      User Feedback
                 (rating + reason, §12)
                            ▼
                  Personalization Engine
              (taste bias inside buildOutfit)
                            ▼
                Improved Recommendations
```

Key files:

| Engine | Client | Server |
| --- | --- | --- |
| Context | `intelligence/contextEngine.ts` (`getRecommendationContext`, `buildMemory`) | `loadItems` + per-action focused loads |
| Style | `intelligence/styleEngine.ts` (`buildStyleProfile`) | `getStyleProfile`, `getIntelligence.styleProfile` |
| Preference | `intelligence/preferenceEngine.ts` (`computePreferenceWeights`, `preferenceDelta`) | `computePreferenceWeights`, taste bias in `buildOutfit` |
| Recommendation | `intelligence/recommendationEngine.ts` (`recommend`) | `generateOutfit`, `analyzePurchase`, `recommendProducts`, … |
| Scoring | `intelligence/scoringEngine.ts` (`blendScores`, `DEFAULT_WEIGHTS`) | `outfitFactors` (5-factor blend), purchase breakdown |
| Confidence | `intelligence/confidenceEngine.ts` (`computeConfidence`) | `confidenceFor` — shipped on outfit + purchase responses |
| Explanation | `intelligence/explanationEngine.ts` (`buildReasons`) | reasons arrays on `generateOutfit` / `analyzePurchase` |
| Personalization | `intelligence/personalizationEngine.ts` (`describePreferenceEffect`) | `recordFeedback`, `recordDetailedFeedback` |

## Data flow (the loop that matters)

```text
Wardrobe rows → Style DNA + Preference weights + AI Memory
  → Context Engine → Recommendation + Scoring
  → Confidence + Explanation → user sees score, confidence, reasons
  → Feedback (rating + reason) stored in `feedback`
  → Personalization bias changes the NEXT outfit's picks
  → Style Evolution / AI Evaluation make the learning visible
```

## State rules (unchanged, still enforced)

- Outfits store **item IDs only**; deleted pieces drop out at read.
- Analytics, health, ROI, gaps are **derived**, never stored counters.
- `storageService` is the only localStorage gateway (session, theme,
  notification preferences). Durable data lives server-side.
- AI operations report `idle → loading → success → error` via
  `SET_AI_STATE`; the app never freezes on an AI call.

## Product surfaces added by the intelligence upgrade

- **Intelligence hub** (new view): health (9 dimensions, explained),
  AI Confidence, AI Memory, preference weights, Wardrobe ROI league,
  insight feed, Style Evolution, AI Evaluation dashboard, smart
  notifications with per-type toggles, 5-minute onboarding progress,
  Demo Reset, Export My Data, Delete My Data.
- **Stylist**: outfits now show AI Confidence + “Why WearWise
  recommends this”; feedback gained reason chips (Too formal, Don't
  like the color, Perfect…) stored via `recordDetailedFeedback`.
- **Buy/Skip**: verdicts now show Wardrobe ROI + AI Confidence next
  to the existing breakdown.
- **Profile**: Export / Reset Demo / Delete My Data controls.
- **Ask WearWise**: routes ROI, health, evolution, confidence and
  memory questions to the Intelligence hub; buy questions still route
  to the full purchase pipeline (analysis + duplicates + gaps + ROI).

## Security & privacy foundations (§22)

- Production authentication (2026-11-16, migration 0008): email +
  password accounts — PBKDF2-HMAC-SHA256 hashes (WebCrypto, 210k
  iterations, random salt) in `profiles.password_hash`; sign-in
  issues a random 256-bit session token, stored only as a SHA-256
  hash in `sessions` (30-day expiry, revoked on logout). Every
  user-scoped action runs `requireAuth`: the session must be live
  and its user must equal the requested `userId` — the `userId` is
  a claim the session backs up, not a credential. The client
  attaches the token automatically (`api.ts` transport layer) and
  revalidates it on load via `getSession`. Accounts created before
  passwords existed are claimed by setting a password at first
  password login; the one-tap demo account stays passwordless,
  is recognised by email + provider, and can never be claimed.
  Login rate limiting landed 2026-11-21 (migration 0009 — see
  AUDIT.md issue 10). Remaining: password reset (needs an email
  channel), true account deletion — see AUDIT.md.
- All inputs are validated with Zod schemas (lengths, ranges, enums)
  on every action; prices and counts are range-capped.
- No API keys exist today and none are in the client bundle;
  `.env.example` documents the future server-side variables.
- Uploaded wardrobe photos (2026-11-28, migration 0010): the photo a
  user uploads in Add Clothing is now saved with the item. The client
  downscales it in the browser (longest edge 1200px, re-encoded JPEG)
  and sends base64; the server re-validates the bytes itself —
  magic-byte sniffing for JPEG/PNG/WebP/GIF plus a ~2 MB decoded cap,
  never trusting the claimed file type — and stores them in blob
  storage under a per-user key (`wardrobe-photos/u<userId>/…`). Only
  the key is kept on the row (`wardrobe_items.photo_blob_key`); photo
  URLs are resolved inside session-gated actions (`loadItems`), so a
  photo is only ever visible to the account that uploaded it. The
  photo can be replaced or removed from Wardrobe → Edit (tri-state
  `photo` on `updateItem`: omitted = keep, null = remove, object =
  replace; the old blob is deleted on replace/remove), deleting the
  item deletes its blob, and the wholesale wipes (Delete My Data,
  Demo Reset, real-wardrobe upgrade) delete all of the user's photo
  blobs first. A missing/corrupt blob resolves to no photo and the
  item falls back to its `imageKey` / colour tile — it never breaks
  the wardrobe. The photo is stored as-is: the scan remains a
  labelled starting guess and never "reads" the image; no confidence
  score was added.
- Export My Data returns wardrobe + outfits + analyses + feedback as
  JSON, plus a `photos` section listing each saved photo with the
  piece it belongs to and a link to the stored image; Delete My Data
  permanently removes all wardrobe-related rows and the stored
  photos with them (account kept so the user can re-seed or start
  fresh).

## Performance (§30)

- Selectors are pure and memoized by React Query's cache; the
  Intelligence hub is two queries (`getIntelligence`,
  `getWardrobeROI`), not per-widget calls.
- Lists are capped server-side; ROI renders top 8 with an explicit
  “show all” instead of paginating silently.
