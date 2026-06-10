# Campaign Tracker

A rules-agnostic, browser-based tabletop campaign tool with a tactical battle map
and combat tracker. It runs **local-first** (no account needed) and can switch to a
**cloud** backend for multi-device sync and collaboration — without any code change,
just environment variables.

The first game system implemented is **D&D 3.5e**, but no game rules live in the UI:
sizes, conditions, initiative, distance, area-of-effect geometry and reach all come
from a pluggable ruleset, so other systems can be added without touching the app.

## Features
- **Battle map** — image background, configurable grid (size, color, offset), zoom/pan,
  tokens with size-aware footprints, drag-to-move with snap and distance readout.
- **AoE templates** — burst / cone / line using the official 3.5e discrete-cell
  geometry, with free-aim rotation and an editor (size, direction, color, opacity).
- **Reach overlay** — per-token threatened squares from the ruleset.
- **Combat tracker** — initiative order, 20 conditions, damage, size, add/clone/rename/
  remove combatants, and token portraits.
- **Shared turn state** — round and active combatant live on the Scene; the active
  token is highlighted on the map.
- **Persistence** — local-first IndexedDB by default; optional Supabase cloud
  (auth, realtime sync, row-level security); JSON export/import for backups.

## Run locally
Requires Node.js (LTS). On Windows, keep the project on a plain path
(e.g. `C:\dev\campaign-tracker`), not inside OneDrive.

```bash
npm install
npm run dev      # http://localhost:5173/campaign-tracker/
npm run build    # production build into dist/
npm run typecheck
```

Out of the box it runs in **local** mode (IndexedDB). The header shows a `LOCAL`/`CLOUD`
badge so you always know which backend is active.

## Cloud mode (optional)
Set two environment variables and the app switches to Supabase with email sign-in and
realtime sync. See **[STEP5-SUPABASE.md](./STEP5-SUPABASE.md)** for the full setup
(project creation, `supabase/schema.sql`, auth config). In short:

```
# .env.local
VITE_SUPABASE_URL=https://YOUR-REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxx
```

Members and roles (GM/player) are managed in-app via the **Members** panel; run
`supabase/02_members.sql` once to enable it.

## Deploy (GitHub Pages)
Pushing to `main` builds and publishes via GitHub Actions (`.github/workflows/deploy.yml`).
Set repo **Settings → Pages → Source: GitHub Actions**. For cloud mode on the live site,
add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as repository secrets.
The Vite `base` must match the repo name (`/campaign-tracker/`).

## Project layout
```
src/
  app/            App shell, auth, members panel
  core/
    domain/       rules-agnostic models + entity factory
    ruleset/      the Ruleset plugin contract + registry
    persistence/  Repository interface + memory / indexeddb / supabase impls
    units.ts      ft <-> m conversion (display layer)
    assets.ts     image -> Asset helper
  systems/dnd35/  the D&D 3.5e ruleset (all D&D-specific code lives here)
  modules/
    combat/       CombatTracker
    map/          MapView
supabase/         schema.sql + migrations
```

## Guides
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — design, pillars, future-features map.
- **[STEP1-SETUP.md](./STEP1-SETUP.md)** — scaffold structure and run/deploy basics.
- **[STEP5-SUPABASE.md](./STEP5-SUPABASE.md)** — cloud backend setup.
