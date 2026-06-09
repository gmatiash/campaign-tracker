# Campaign Tracker — Architecture Starter

A rules-agnostic, collaborative tabletop campaign platform. The combat tracker is
**one module**; the platform also covers campaigns, characters, maps, notes, and
(later) shared inventory/loot and fog of war.

## Pillars
1. **Rules-agnostic core + systems as plugins.** The core knows nothing about any
   game. Each system (D&D 3.5e, World of Darkness, BattleTech, Cyberpunk) is a
   plugin that implements the `Ruleset` contract.
2. **Local-first + collaborative.** IndexedDB is the local cache; Supabase is the
   source of truth for sync, auth, realtime, and per-user visibility. Everything
   goes through one `Repository` interface, so feature code never cares which.
3. **Collaboration-ready data model.** Every record carries ownership, visibility,
   and timestamps from day one, so fog of war / GM secrets are enforceable server
   side (Supabase Row-Level Security) without a later re-model.

## Folder structure
```
src/
  app/                     # shell, routing, providers, auth gate
  core/
    domain/                # rules-agnostic models (domain.ts, map.ts)
    ruleset/               # the Ruleset plugin contract + registry (ruleset.ts)
    persistence/           # Repository interface (repository.ts)
      indexeddb/           #   local-first impl (Dexie)            [step 4]
      supabase/            #   cloud impl (auth/realtime/RLS)      [step 5]
      sync/                #   write-through + offline reconcile   [step 5]
    dice/                  # shared dice engine
  systems/                 # ruleset plugins
    dnd35/                 # first implementation (dnd35.ts)
    wod/                   # second system, validates abstraction [step 3]
    battletech/            # hex grid + heat/armor                [later]
  modules/                 # feature UIs
    campaign/  characters/  maps/  combat/  notes/  inventory/
  shared/ui/  shared/hooks/  lib/
```

## Where the future features attach (no foundation change)
- **Spell effects/images** -> `AoeTemplate.effect` + `assetId` (see map.ts). UI/render only.
- **Walls** -> `MapDoc.walls` geometry layer (see map.ts). A Line-of-Sight engine
  (later module) reads walls to drive fog of war, light, and spell-range limits.
  Player-side fog is enforced by Supabase RLS, not the client.
- **AI map generation** -> produces an `Asset` (source: "ai"); the call runs in a
  Supabase Edge Function so the API key stays server-side.
- **AI wall detection** -> consumes a map `Asset`, outputs `Wall[]` into the geometry
  layer; always followed by a manual wall editor for cleanup. Depends on walls.
- **Unit switch (ft <-> m)** -> display-layer only. Distances stay canonical (feet);
  `core/units.ts` converts for display and the preference lives on
  `Campaign.settings.distanceUnit`. No data-model or rules change.

## Roadmap (agreed)
1. Refactor current app -> modular + TypeScript.
2. Extract core; re-express D&D 3.5e behind `Ruleset` (pure refactor).
3. Add a contrasting system (WoD or BattleTech) to stress-test the abstraction.
4. `Repository` + IndexedDB local-first impl + JSON export/import.
5. Supabase backend behind the same `Repository`: auth -> realtime -> RLS visibility,
   then collaborative features (shared inventory/loot, fog of war).
