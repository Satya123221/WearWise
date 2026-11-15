# WearWise

**Know what you own. Know what to wear. Know what to buy.**

An AI-powered personal wardrobe and shopping intelligence platform.
One wardrobe powers everything: the AI Stylist, outfit generator, Style DNA,
Snap & Style, Buy-or-Skip with duplicate detection and What-If simulation,
wardrobe gap analysis, Smart Shopping, Weather Stylist, Pack Smart and
Ask WearWise all read and write the same underlying data.

## Run it

This is a Muse web artifact (TypeScript space):

- `client/` — React client (`client/src/App.tsx` is the shell; shared models
  in `client/src/models/`, the central store in `client/src/store/`,
  services in `client/src/services/`)
- `server/src/actions.ts` — typed server actions; all intelligence lives here
  and computes from the user's real wardrobe rows
- `server/src/schema.ts` — database schema (profiles, wardrobe_items,
  saved_outfits, buy_analyses, feedback)
- `drizzle/` — SQL migrations

No environment variables or API keys are required (see `.env.example`).

## Architecture

See **ARCHITECTURE.md** (system + Intelligence Layer) and
**AI_ARCHITECTURE.md** (per-feature AI status, provider abstraction,
future integration points).

```text
User
  ↓
WearWise State (React Context + useReducer — WearWiseProvider)
  ↓
Wardrobe (server rows = single source of truth)
  ↓
Intelligence Layer — Context · Style · Preference · Recommendation
                     Scoring · Confidence · Explanation · Personalization
  ↓
Services (wardrobeService / aiService / shoppingService / weatherService / storageService)
  ↓
Outfits · Insights · Recommendations (score + confidence + reasons)
  ↓
User Feedback (rating + reason, feedback table)
  ↓
Updated Preferences → better recommendations
```

The **Intelligence** view is the hub for the layer: Wardrobe Health
(9 explained dimensions), AI Confidence, AI Memory, preference
weights, Wardrobe ROI, insight feed, Style Evolution, AI Evaluation,
smart notifications, 5-minute onboarding progress, Demo Reset, and
Export / Delete My Data.

Outfits reference clothing **item IDs only** — never embedded clothing
objects — so editing or deleting a piece is reflected everywhere, and a
deleted piece drops out of saved outfits gracefully at read time.
Analytics (health score, cost-per-wear, colour distribution, gaps) are
derived from the wardrobe rows, never stored as frozen counters.

## AI feature status

| Feature | Status |
| --- | --- |
| Clothing scan (Add Clothing) | Mock AI — editable "starting guess", no fake confidence |
| Style DNA | Deterministic derivation from wardrobe + feedback |
| Outfit engine (5-factor scoring) | Deterministic, feedback-aware |
| Snap & Style | Mock AI scoring anchored on owned items |
| Buy / Skip, Duplicate Detector, What If | Deterministic over wardrobe rows |
| Gap analysis, insights, analytics | Deterministic derivation |
| Weather Stylist | Demo weather reading behind a service seam |
| Pack Smart | Deterministic capsule from owned pieces |
| Ask WearWise | Intent routing over the real services (incl. ROI / health / evolution) |
| Smart Shop | Real branded catalogue (Meta Catalog, India/INR) |
| Intelligence Layer | Unified engines — every outfit/purchase ships score + confidence + reasons; advanced feedback (rating + reason) updates preference weights that bias future picks |
| Wardrobe ROI / Health / Evaluation | Deterministic derivations, shown in the Intelligence hub |

## Future integration points (Tier 4)

- **Computer vision / CLIP / YOLO** → replace the scan guess in
  `analyzeClothing` and Snap & Style scoring behind the same action contract
- **LLM** → Ask WearWise's intent router is the seam
- **Weather API** → `weatherService` / `getWeatherOutfit`
- **Product APIs / affiliate feeds** → the `Product` model is source-agnostic
- **Firebase** → `storageService` is the only localStorage gateway;
  durable data already lives server-side
- **Virtual try-on / wardrobe video scanning** → new actions behind the
  existing service layer

## Known limitations

- The clothing scan is a starting guess, not real vision — the user reviews
  and corrects it before saving.
- Weather is a fixed demo reading, labelled as such in the UI.
- Seeded/demo pieces show fit "Regular" and formality-derived occasions
  until the user edits them; no per-product fit data is invented.
- **Sign-in is demo-grade** (name + email, no password or session token;
  actions trust the client-supplied user id). Production auth is the #1
  pre-launch fix — see **AUDIT.md** for the full senior technical audit
  (health scores, AI capability matrix, ranked issues, fix order).


---

## Push this code to GitHub

This zip is the complete, current WearWise source (one `wearwise/` folder).
To put it on GitHub:

1. Unzip it, then go to <https://github.com/new> and create an empty
   repository named `wearwise` — do **not** tick "Add a README file"
   (this folder already has one).
2. Open a terminal inside the unzipped `wearwise/` folder and run:

   ```bash
   git init
   git add .
   git commit -m "WearWise — latest code (Intelligence Layer, Unique Edge, audit fixes)"
   git branch -M main
   git remote add origin https://github.com/<your-username>/wearwise.git
   git push -u origin main
   ```

3. When GitHub asks for a password, use a **personal access token**,
   not your account password: GitHub → Settings → Developer settings →
   Personal access tokens → generate one with `repo` scope, and paste
   that token as the password.

Already have the older `wearwise` repo from the previous zip? Unzip this
over a fresh clone, then `git add .`, commit and `git push` as usual —
or replace the repo contents with this folder for a clean match.

## Running the code

WearWise is built as a Muse TypeScript web artifact (Bun + React +
server actions + Drizzle/SQLite):

```bash
bun install
bun run typecheck   # client + server, strict TypeScript
bun run build       # builds server actions and the client bundle
```

- `client/` — React client. `client/src/App.tsx` is the shell; shared
  models live in `client/src/models/`, the central store (React Context
  + useReducer) in `client/src/store/`, services in
  `client/src/services/`, and the Intelligence Layer engines in
  `client/src/intelligence/`.
- `server/src/actions.ts` — 50 typed, Zod-validated server actions; all
  intelligence computes here from the user's real wardrobe rows.
- `server/src/schema.ts` + `drizzle/` — database schema and migrations
  0001–0007 (0007 adds `user_id` indexes on all user-scoped tables).
- No API keys or environment variables are needed (see `.env.example`).

Note: the client talks to the server actions through
`@hatch/space-sdk`, Muse's hosting SDK. Running WearWise fully
standalone outside Muse means replacing that thin RPC client
(`client/src/api.ts`) and the action host with your own HTTP server —
the action functions, models and UI need no changes. See `AUDIT.md`
for the pre-launch list, including production authentication (the
current sign-in is demo-grade by design and is the #1 fix before real
users).
