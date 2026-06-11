# Campaign Tracker

A rules-agnostic, browser-based tabletop tool with a tactical battle map, combat
tracker, dynamic lighting, line-of-sight fog of war, and real-time multiplayer. It
runs **local-first** (no account, data stays in the browser) and can switch to a
**cloud** backend for multi-device sync and collaboration — with no code change, just
two environment variables.

The first game system is **D&D 3.5e**, but no game rules live in the UI. Sizes,
conditions, initiative, distance, area-of-effect geometry, and reach all come from a
pluggable `Ruleset`, so another system can be added without touching the app.

## Features

### Battle map
- Image background with **automatic grid detection** on upload (estimates cell size
  and offset in-browser, no AI/API). Configurable grid size, color, and X/Y offset.
- Zoom (wheel), pan (drag), and fit-to-view.
- Tokens with **size-aware footprints** (Fine → Colossal), per-token **color**, and
  **portraits**; **same-cell stacking** so every token stays visible.
- On-token **condition icons**, a **damage badge**, and **dead/unconscious** tokens
  that desaturate and drop beneath living ones.
- **Distance units** — toggle **ft ↔ m** in the toolbar; the preference is shared by the
  campaign. All distances stay canonical in feet and only the display converts.
- **Wall-aware movement** — drag a token and it traces the shortest path **around walls**
  (doors are passable), with the distance measured **along that path** (3.5e 1-2-1
  diagonals). If the target is walled off, the trace turns red and the move is refused.
  With no walls, it's a straight line as before.

### Lighting & vision (GM)
- **Light sources**, token-attached or independent: **radial** (5 / 15 / 20 / 30 ft of
  clear light, with shadowy light to twice that) or a **60 ft cone** with an aim slider.
  Light is **occluded by walls** via a per-cell raycast.
- Token **vision**: **low-light** (doubles every light's clear + shadowy range, from that
  token's view) and **darkvision** (sees its own radius as bright, even in the dark).
- **Selection-aware field of view** — by default you see the GM "god view" (full
  illumination). **Select a token** and the scene is recomputed from *its* line of sight:
  lit areas it can't actually see (e.g. a lit room across a wall) go dark, and tokens it
  can't see are hidden. Token-carried lights move with the token.

### Fog of war, walls & doors (GM)
- **Fog** on/off; **Reveal**/**Hide** by dragging a box; **Room** flood-fill bounded by
  walls; **Reveal all** / **Hide all**.
- **Token line-of-sight fog** (`LoS fog`) — auto-reveals what the **party (all PC tokens)**
  can see, using each token's light/vision FOV blocked by walls. Reveals are additive, so
  the explored map stays revealed; pair it with **Lighting** to dim explored-but-unlit areas.
- **Walls** (drag along grid lines; double-click to remove) bound the room flood and block
  light and sight.
- **Doors** block light and sight while closed, but count as **open** once both sides are
  revealed — light and vision then pass through (open doors render hollow).
- **View as player** previews exactly what players see — no walls, hidden tokens, or
  unrevealed areas.

### Spell areas & reach
- **AoE templates** — burst / cone / line using official 3.5e discrete-cell geometry,
  with free-aim rotation and an editor (size, direction, color, opacity).
- **AoE effects** — give a template a themed look: presets (**fire, water, mud, mist, ice,
  acid**) rendered per cell, or **upload an image** that tiles semi-transparently across
  every affected cell.
- **Reach overlay** of threatened squares, plus a per-token **reach-weapon** toggle that
  shows the doubled outer ring (threatens at range, not adjacent).

### Combat tracker
- Initiative order, the 20 canonical 3.5e **conditions** (with icons), damage, size,
  and color per combatant; add / clone / rename / remove (removing prunes map tokens).
- **Turn flow** — Start/Order, Roll NPC initiative, Next turn; round and the active
  combatant live on the shared Scene and highlight the active token on the map.
- **Undo turn** — state is snapshotted at the start of every turn so you can step back.
- **New combat** — clears the encounter (NPCs, tokens, templates, map image, fog, walls,
  lights, damage, conditions, initiative, round) while keeping the party (PCs).

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

Run the SQL in `supabase/` once (schema, members, storage). All feature data (lights,
vision, AoE effects, unit preference, fog) lives inside the JSONB records, so adding
features never needs a database migration. Members and roles are managed in the
**Members** panel; share access with the **Invite** button.

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
    lighting.ts              # wall-occluded light + vision raycast engine
  systems/dnd35/             # the D&D 3.5e ruleset (all D&D-specific code)
  modules/
    combat/                  # CombatTracker + turn-history (undo)
    map/                     # MapView (grid, tokens, movement, AoE, reach, lighting, fog)
supabase/                    # schema.sql + 02_members.sql + 03_storage.sql
.github/workflows/deploy.yml # build + deploy to GitHub Pages
```

## Guides
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — design pillars, data model, and where
  each feature attaches.
- **[STEP1-SETUP.md](./STEP1-SETUP.md)** — local setup & development.
- **[STEP5-SUPABASE.md](./STEP5-SUPABASE.md)** — cloud backend (auth, sync, RLS, storage).
