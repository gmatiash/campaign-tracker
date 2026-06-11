# Campaign Tracker — Architecture

A rules-agnostic, collaborative tabletop platform. The combat tracker and battle map
are **modules**; the platform also covers campaigns, characters, scenes, maps, assets,
and notes, and is built so fog of war and GM secrets are enforceable server-side later.

## Pillars
1. **Rules-agnostic core + systems as plugins.** The core knows nothing about any
   game. Each system (D&D 3.5e today; e.g. World of Darkness, BattleTech later) is a
   plugin implementing the `Ruleset` contract: sizes, conditions, initiative, distance,
   AoE geometry, reach. UI modules read everything game-specific from the active ruleset.
2. **Local-first + collaborative.** IndexedDB is the local store; Supabase is the
   cloud source of truth for sync, auth, realtime, and per-user visibility. All feature
   code talks to one `Repository` interface, so it never cares which backend is active.
3. **Collaboration-ready data model.** Every record carries ownership, visibility, and
   timestamps from day one, so permissions and secrecy can be enforced by Supabase
   Row-Level Security without a later re-model. Feature data is stored inside a JSONB
   record, so new features (lights, vision, AoE effects, units) need no DB migration.

## Layering (the seams that matter)
- **`Ruleset`** (`core/ruleset/ruleset.ts`) — the game-rules seam. Implemented by
  `systems/dnd35/dnd35.ts`; registered in `systems/index.ts` (the only D&D import site).
- **`Repository`** (`core/persistence/repository.ts`) — the storage seam. Reactive
  `subscribe`; implementations: `memory/`, `indexeddb/` (local-first, soft-delete
  tombstones, cross-tab sync), `supabase/` (a single `records` JSONB table with realtime
  + RLS). `App.tsx` picks the impl from whether Supabase env vars are present.
- **Pure engines** (`core/units.ts`, `core/gridDetect.ts`, `core/lighting.ts`) — framework-
  free functions the UI calls. They take plain inputs and return plain data, so they're
  easy to reason about and (later) unit-test.
- **UI modules** (`modules/`, `app/`) — talk only to `Repository`, `Ruleset`, and engines.

## Folder structure
```
src/
  app/
    App.tsx                  # mode select, bootstrap/seed, header, role (isGm), composition
    MembersPanel.tsx         # GM manages member roles (cloud)
    InvitePanel.tsx          # invite-link modal (cloud)
    auth/                    # SignIn (magic link) + useSession
  core/
    domain/
      domain.ts              # Id, BaseRecord, Campaign(+settings), CampaignMember, Entity, Scene, Note
      map.ts                 # GridConfig, TokenPlacement, AoeTemplate, Wall, LightSource, FogState, MapDoc, Asset
      factory.ts             # createEntity / cloneEntity
    ruleset/ruleset.ts       # Ruleset contract + registry; ConditionDef, SizeDef, AoE types
    persistence/
      repository.ts          # the storage seam
      memory/  indexeddb/  supabase/
      io.ts                  # export / import campaign as JSON
    units.ts                 # canonical feet <-> display unit
    assets.ts                # File -> Asset (Supabase Storage upload, else data URL) + removeImage
    gridDetect.ts            # heuristic in-browser grid detection (no AI)
    lighting.ts              # cell raycast: wall-occluded light + cone + low-light + darkvision + viewer FOV
  systems/
    index.ts                 # registers systems
    dnd35/dnd35.ts           # D&D 3.5e ruleset
  modules/
    combat/CombatTracker.tsx # roster, initiative, conditions, damage, reach toggle, New combat
    combat/turnHistory.ts    # snapshot stack for Undo turn
    map/MapView.tsx          # grid, tokens, movement paths, AoE+effects, reach, lighting, fog/walls/doors
supabase/
  schema.sql                 # records + campaign_members, RLS, ensure_membership, realtime
  02_members.sql             # display_name + set_member_role (member management)
  03_storage.sql             # campaign-images bucket + write policy
```

## Data model (core/domain)
- **BaseRecord** — `id`, `campaignId`, `ownerId`, `visibility`, timestamps, soft-delete.
  Every stored record extends it.
- **Campaign** — `rulesetId`, `members[]`, and `settings` (incl. `distanceUnit` for the
  ft ↔ m display toggle).
- **Entity** — a combatant/character: `attributes` (free bag incl. `damage`, `initiative`,
  `reachWeapon`, and vision/light: `lightFt`, `lightCone`, `lightDir`, `lowLight`,
  `darkvisionFt`), `conditions[]`, `sizeId`, `color?`, `portraitAssetId?`, `kind` (pc/npc).
- **Scene** — encounter state: `round`, `activeEntityId?`, `mapId?`. Round and active turn
  are shared, not local, so they sync and persist.
- **MapDoc** — `grid` (cell size/color/offset/kind), `tokens[]`, `aoeTemplates[]` (each with
  an optional `effect`: a preset kind or a tiled custom image), `walls[]` (unit-edge
  segments; `door?` flag), `lights[]` (independent `LightSource`s), `fog`
  (`enabled`, `revealed` cell list), `backgroundAssetId?`.
- **Asset** — an image: `storageRef` (data URL or public Storage URL), `storagePath?`
  (object path for cleanup), `width/height`, `source` (`upload` | `ai`).

## Notable design decisions
- **Discrete-cell geometry, not vectors.** AoE areas (`aoeCells`), reach (`reachCells`),
  stacking, movement paths, and lighting all work in grid cells, matching 3.5e templates
  exactly. Reach weapons reuse `reachCells` with a doubled reach minus the inner ring.
- **Lighting/vision is a pure engine.** `core/lighting.ts` takes light sources, an optional
  viewer, and wall segments, and returns a per-cell map of bright/dim. Light is occluded by
  a per-cell line-of-sight raycast; cone sources add an angle test; **low-light** doubles a
  source's clear + shadowy bands; **darkvision** lights the viewer's own radius. When a
  viewer (the selected token) is present, a second raycast **masks the result to that token's
  field of view** — lit cells it can't see are dropped, so it never "sees through" walls.
  No viewer = the GM god view.
- **Wall-aware movement.** Dragging a token runs a Dijkstra path that never crosses a wall
  (doors are passable for movement); distance is summed **along the path** with 3.5e
  diagonals, and an unreachable target is refused. With no walls it degrades to a straight
  line, so behaviour is unchanged on open maps.
- **Doors open contextually.** A door blocks light and sight while closed but is treated as
  **open** once both cells it separates are revealed (or when fog is off). Movement always
  passes doors. This keeps "explored corridors" lit without a separate open/close toggle.
- **Fog: manual + line-of-sight, client-side (today).** Fog/wall/light data lives in the
  shared `MapDoc`. `LoS fog` auto-reveals the union of all **PC** tokens' visible cells
  (their lighting FOV), additively — the GM computes it and shares only the revealed cells,
  so players receive an explored map without the raw geometry. For a screen-shared table
  ("View as player") this is total; on players' own devices it is presentational, not
  cryptographic. **True secrecy** needs server-side per-player filtering — see the roadmap.
- **Grid auto-detection is heuristic, not AI.** `gridDetect.ts` decodes the file, builds
  edge projection profiles, and uses autocorrelation for the cell period and phase for the
  offset. Free, in-browser, no key; it pre-fills the sliders on upload.
- **Units are display-only.** Distances are canonical feet everywhere in rules math; only
  presentation converts via `core/units.ts`, with the choice on `Campaign.settings`.
- **Role (`isGm`)** is resolved from `campaign_members` after bootstrap and passed to the
  map so GM-only tools (fog, walls, lighting) never render for players. Local mode is GM.

## Where future features attach (no foundation change)
- **AI map generation** → produces an `Asset` (`source: "ai"`); the call belongs in a
  Supabase Edge Function so any API key stays server-side.
- **AI/CV wall detection** → consumes a map `Asset`, outputs `Wall[]`; always followed by
  the manual wall/door editor for cleanup. (Deferred — noisy/costly; manual is fine today.)
- **True player-side secrecy** → split hidden content into GM-only records (RLS denies
  players) and/or enable Realtime Authorization so hidden state never reaches a client.
- **Multi-campaign** → create/list/invite UI and unique campaign ids; the data model and
  membership table already support it (the app currently pins a single `camp-1`).
- **Second rule system** → add `systems/<name>/` implementing `Ruleset`; validates the
  abstraction without touching modules.
- **Geometry tests** → `aoeCells`, `reachCells`, `measureDistanceFt`, and `lighting` have
  Vitest coverage; CI runs typecheck + tests before every deploy. Stacking and
  `gridDetect` remain to cover.

## Status
Done: modular TS core; D&D 3.5e ruleset; IndexedDB local-first + JSON export/import;
Supabase cloud (auth, realtime, RLS) + member roles + invite; battle map with tokens,
colors, portraits, conditions/damage on tokens, same-cell stacking, dead/unconscious
state; ft ↔ m unit switch; wall-aware movement with path tracing; speed-based movement
range (move/double/run); standalone ruler; AoE templates + effects (presets and tiled
images); reach overlay + reach weapons; dynamic lighting & vision (radial/cone, low-light,
darkvision, wall occlusion, selection-aware FOV, ambient light level, light colour +
flicker); fog of war with manual tools + token line-of-sight auto-reveal; walls +
open/closed doors + secret doors; conditions with round durations; turn flow with shared
Scene state + Undo; New combat / Reset to demo; Supabase Storage for images; in-browser
grid auto-detection; Vitest + CI typecheck/test gate.

Not yet: map/scene library, GM ping & annotation layer, per-player token control + personal
vision, true server-side secrecy, multi-campaign UI, a second rule system, AI map/wall
generation.
