# Campaign Tracker

A rules-agnostic, browser-based tabletop tool with a tactical battle map, combat
tracker, fog of war, and real-time multiplayer. It runs **local-first** (no account,
data stays in the browser) and can switch to a **cloud** backend for multi-device
sync and collaboration — with no code change, just two environment variables.

The first game system is **D&D 3.5e**, but no game rules live in the UI. Sizes,
conditions, initiative, distance, area-of-effect geometry, and reach all come from a
pluggable `Ruleset`, so another system can be added without touching the app.

## Features

### Battle map
- Image background with **automatic grid detection** on upload (estimates cell size
  and offset in-browser, no AI/API). Configurable grid size, color, and X/Y offset.
- Zoom (wheel), pan (drag), and fit-to-view.
- Tokens with **size-aware footprints** (Fine → Colossal), per-token **color**, and
  **portraits**; drag to move with grid snap and a live distance readout.
- On-token **condition icons**, a **damage badge**, and **dead/unconscious** tokens
  that desaturate and drop beneath living ones.
- **Same-cell stacking**: sub-Small creatures pack into a sub-grid, larger creatures
  layer beneath smaller ones, and same-size tokens fan out so each stays visible.

### Fog of war + walls + doors (GM)
- **Fog** on/off; **Reveal**/**Hide** by dragging a box; **Room** flood-fill that
  reveals or hides a whole area bounded by walls; **Reveal all** / **Hide all**.
- **Walls** (drag along grid lines; double-click to remove) bound the room flood.
- **Doors** block like walls but are shown to players from a revealed side.
- **View as player** previews exactly what players see — players never see walls,
  hidden tokens, or unrevealed areas.

### Spell areas & reach
- **AoE templates** — burst / cone / line using official 3.5e discrete-cell geometry,
  with free-aim rotation and an editor (size, direction, color, opacity).
- **Reach overlay** of threatened squares, plus a per-token **reach-weapon** toggle
  that shows the doubled outer ring (threatens at range, not adjacent).

### Combat tracker
- Initiative order, the 20 canonical 3.5e **conditions** (with icons), damage, size,
  and color per combatant; add / clone / rename / remove (removing prunes map tokens).
- **Turn flow** — Start/Order, Roll NPC initiative, Next turn; round and the active
  combatant live on the shared Scene and highlight the active token on the map.
- **Undo turn** — state is snapshotted at the start of every turn so you can step back.
- **New combat** — clears the encounter (NPCs, tokens, templates, map image, fog,
  walls, damage, conditions, initiative, round) while keeping the party (PCs).

### Collaboration & persistence
- **Local-first** IndexedDB by default; nothing leaves the browser.
- **Cloud** (optional) — Supabase email sign-in, real-time sync, row-level security,
  member roles (GM / player), and an **Invite** link.
- **Images** go to Supabase Storage in cloud mode, so records stay small.
- **JSON export / import** for backups in any mode.

## Run locally
Requires Node.js (LTS). On Windows keep the project on a plain path
(e.g. `C:\dev\campaign-tracker`), not inside OneDrive (a `&` in a path can break the shell).

```bash
npm install
npm run dev        # http://localhost:5173/campaign-tracker/
npm run build      # production build into dist/
npm run typecheck  # tsc --noEmit
```

Out of the box it runs in **local** mode (IndexedDB). The header shows a `LOCAL` /
`CLOUD` badge so you always know which backend is active. See
**[STEP1-SETUP.md](./STEP1-SETUP.md)** for the local development guide.

## Cloud mode (optional)
Set two environment variables and the app switches to Supabase (email sign-in,
real-time sync, permissions). See **[STEP5-SUPABASE.md](./STEP5-SUPABASE.md)** for the
full setup. In short:

```
# .env.local  (Vite reads this file; it is NOT .env.example)
VITE_SUPABASE_URL=https://YOUR-REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxx
```

Run the SQL in `supabase/` once (schema, members, storage). Members and roles are
managed in the **Members** panel; share access with the **Invite** button.

## Deploy (GitHub Pages)
Pushing to `main` builds and publishes via GitHub Actions
(`.github/workflows/deploy.yml`). Set repo **Settings → Pages → Source: GitHub Actions**.
For cloud mode on the live site, add `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` as **repository secrets**. The Vite `base` must match
the repo name (`/campaign-tracker/`).

## Project layout
```
src/
  app/                       # shell, auth gate, members & invite panels
    auth/                    # magic-link sign-in + session hook
  core/
    domain/                  # rules-agnostic models + entity factory
    ruleset/                 # the Ruleset plugin contract + registry
    persistence/             # Repository interface + memory / indexeddb / supabase
    units.ts                 # ft <-> m conversion (display layer)
    assets.ts                # image -> Asset (Supabase Storage or data URL)
    gridDetect.ts            # in-browser grid auto-detection
  systems/dnd35/             # the D&D 3.5e ruleset (all D&D-specific code)
  modules/
    combat/                  # CombatTracker + turn-history (undo)
    map/                     # MapView (grid, tokens, AoE, reach, fog/walls)
supabase/                    # schema.sql + 02_members.sql + 03_storage.sql
.github/workflows/deploy.yml # build + deploy to GitHub Pages
```

## Guides
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — design pillars, data model, and where
  each feature attaches.
- **[STEP1-SETUP.md](./STEP1-SETUP.md)** — local setup & development.
- **[STEP5-SUPABASE.md](./STEP5-SUPABASE.md)** — cloud backend (auth, sync, RLS, storage).
