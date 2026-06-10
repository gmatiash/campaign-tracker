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
   Row-Level Security without a later re-model.

## Layering (the seams that matter)
- **`Ruleset`** (`core/ruleset/ruleset.ts`) — the game-rules seam. Implemented by
  `systems/dnd35/dnd35.ts`; registered in `systems/index.ts` (the only D&D import site).
- **`Repository`** (`core/persistence/repository.ts`) — the storage seam. Reactive
  `subscribe`; implementations: `memory/`, `indexeddb/` (local-first, soft-delete
  tombstones, cross-tab sync), `supabase/` (a single `records` JSONB table with realtime
  + RLS). `App.tsx` picks the impl from whether Supabase env vars are present.
- **UI modules** (`modules/`, `app/`) — talk only to `Repository` + `Ruleset`.

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
      domain.ts              # Id, BaseRecord, Campaign, CampaignMember, Entity, Scene, Note
      map.ts                 # GridConfig, TokenPlacement, AoeTemplate, Wall, FogState, MapDoc, Asset
      factory.ts             # createEntity / cloneEntity
    ruleset/ruleset.ts       # Ruleset contract + registry; ConditionDef, SizeDef, AoE types
    persistence/
      repository.ts          # the storage seam
      memory/  indexeddb/  supabase/
      io.ts                  # export / import campaign as JSON
    units.ts                 # canonical feet <-> display unit
    assets.ts                # File -> Asset (Supabase Storage upload, else data URL) + removeImage
    gridDetect.ts            # heuristic in-browser grid detection (no AI)
  systems/
    index.ts                 # registers systems
    dnd35/dnd35.ts           # D&D 3.5e ruleset
  modules/
    combat/CombatTracker.tsx # roster, initiative, conditions, damage, reach toggle, New combat
    combat/turnHistory.ts    # snapshot stack for Undo turn
    map/MapView.tsx          # grid, tokens, stacking, AoE, reach, fog/walls/doors, grid auto-detect
supabase/
  schema.sql                 # records + campaign_members, RLS, ensure_membership, realtime
  02_members.sql             # display_name + set_member_role (member management)
  03_storage.sql             # campaign-images bucket + write policy
```

## Data model (core/domain)
- **BaseRecord** — `id`, `campaignId`, `ownerId`, `visibility`, timestamps, soft-delete.
  Every stored record extends it.
- **Entity** — a combatant/character: `attributes` (free bag incl. `damage`, `initiative`,
  `reachWeapon`), `conditions[]`, `sizeId`, `color?`, `portraitAssetId?`, `kind` (pc/npc).
- **Scene** — encounter state: `round`, `activeEntityId?`, `mapId?`. Round and active turn
  are shared, not local, so they sync and persist.
- **MapDoc** — `grid` (cell size/color/offset/kind), `tokens[]`, `aoeTemplates[]`,
  `walls[]` (unit-edge segments; `door?` flag), `fog` (`enabled`, `revealed` cell list),
  `backgroundAssetId?`.
- **Asset** — an image: `storageRef` (data URL or public Storage URL), `storagePath?`
  (object path for cleanup), `width/height`, `source` (`upload` | `ai`).

## Notable design decisions
- **Discrete-cell geometry, not vectors.** AoE areas (`aoeCells`), reach (`reachCells`),
  and stacking all work in grid cells, matching 3.5e templates exactly. Reach weapons
  reuse `reachCells` with a doubled reach and subtract the inner ring (the "donut").
- **Fog is client-side (today).** Fog/wall data lives in the shared `MapDoc`; players
  simply don't render hidden areas, and hidden tokens aren't drawn. For a screen-shared
  table ("View as player") this is total; for players on their own devices it is
  presentational, not cryptographic. **True secrecy** needs server-side per-player
  filtering — see the roadmap.
- **Grid auto-detection is heuristic, not AI.** `gridDetect.ts` decodes the uploaded
  file, builds edge projection profiles, and uses autocorrelation for the cell period and
  phase for the offset. Free, in-browser, no key; it pre-fills the sliders on upload.
- **Role (`isGm`)** is resolved from `campaign_members` after bootstrap and passed to the
  map so GM-only tools (fog/walls) never render for players. Local mode is always GM.

## Where future features attach (no foundation change)
- **AI map generation** → produces an `Asset` (`source: "ai"`); the call belongs in a
  Supabase Edge Function so any API key stays server-side.
- **AI/CV wall detection** → consumes a map `Asset`, outputs `Wall[]`; always followed by
  the manual wall/door editor for cleanup. (Deferred — noisy/costly; manual is fine today.)
- **Token line-of-sight fog** → raycast token positions against `walls[]` to auto-reveal
  as tokens move; the wall geometry and fog model already exist.
- **True player-side secrecy** → split hidden content into GM-only records (RLS denies
  players) and/or enable Realtime Authorization (private channels) so hidden state never
  reaches a player's client.
- **Multi-campaign** → create/list/invite UI and unique campaign ids; the data model and
  membership table already support it (the app currently pins a single `camp-1`).
- **Unit switch (ft ↔ m)** → display-only; distances stay canonical feet via
  `core/units.ts`, preference on `Campaign.settings.distanceUnit`.
- **Second rule system** → add `systems/<name>/` implementing `Ruleset`; validates the
  abstraction without touching modules.

## Status
Done: modular TS core; D&D 3.5e ruleset; IndexedDB local-first + JSON export/import;
Supabase cloud (auth, realtime, RLS) + member roles + invite; battle map with tokens,
colors, portraits, conditions/damage on tokens, same-cell stacking, dead/unconscious
state; AoE templates; reach overlay + reach weapons; turn flow with shared Scene state +
Undo; New combat / Reset to demo; Supabase Storage for images; client-side fog of war +
walls + doors; in-browser grid auto-detection.

Not yet: token line-of-sight fog, true server-side secrecy, multi-campaign UI, a second
rule system, unit-switch UI, AI map/wall generation.
