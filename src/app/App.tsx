// src/app/App.tsx
import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import type { Campaign, Id, Scene } from "../core/domain/domain";
import type { MapDoc } from "../core/domain/map";
import { createEntity } from "../core/domain/factory";
import { IndexedDbRepository } from "../core/persistence/indexeddb/IndexedDbRepository";
import { exportCampaign, importCampaign, downloadBackup } from "../core/persistence/io";
import { getRuleset } from "../core/ruleset/ruleset";
import "../systems"; // registers all available rule systems
import CombatTracker from "../modules/combat/CombatTracker";
import MapView from "../modules/map/MapView";

const CAMPAIGN_ID: Id = "camp-1";
const OWNER: Id = "local-user";
const MAP_ID: Id = "map-1";
const SCENE_ID: Id = "scene-1";
const DEMO_RULESET_ID = "dnd35"; // which system the demo campaign uses (config, not branding)

// Local-first persistence. Same Repository interface as before, so this is a swap,
// not a rewrite. Becomes SupabaseRepository (cloud + realtime + RLS) in step 5.
const repo = new IndexedDbRepository();
const demoRuleset = getRuleset(DEMO_RULESET_ID);

// Seed demo content ONLY on first run. On later loads the persisted data wins,
// so user edits are never clobbered. Guarded against React StrictMode double-invoke.
let bootstrapped = false;
async function bootstrap(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  const now = Date.now();

  if (!(await repo.get("campaigns", CAMPAIGN_ID))) {
    const campaign: Campaign = {
      collection: "campaigns", id: CAMPAIGN_ID, campaignId: CAMPAIGN_ID, ownerId: OWNER,
      visibility: { kind: "party" }, createdAt: now, updatedAt: now, schemaVersion: 1,
      name: "Demo Campaign", rulesetId: DEMO_RULESET_ID,
      members: [{ userId: OWNER, role: "gm", displayName: "GM" }],
    };
    await repo.put("campaigns", campaign);
    const mk = (id: Id, name: string, kind: "pc" | "npc", sizeId: string, initiativeMod: number) =>
      createEntity({ campaignId: CAMPAIGN_ID, ownerId: OWNER, ruleset: demoRuleset, id, name, kind, sizeId, initiativeMod });
    await repo.put("entities", mk("e-pc", "Mira Voss", "pc", "medium", 3));
    await repo.put("entities", mk("e-n1", "Raider 1", "npc", "small", 1));
    await repo.put("entities", mk("e-n2", "Raider 2", "npc", "small", 1));

    const map: MapDoc = {
      collection: "maps", id: MAP_ID, campaignId: CAMPAIGN_ID, ownerId: OWNER,
      visibility: { kind: "party" }, createdAt: now, updatedAt: now, schemaVersion: 1,
      name: "Demo Map", width: 1600, height: 900,
      grid: {
        kind: demoRuleset.grid.kind, cellPx: 50, cellFt: demoRuleset.grid.cellFt,
        offsetX: 0, offsetY: 0, color: "rgba(212,175,55,0.35)",
      },
      tokens: [
        { entityId: "e-pc", gx: 3, gy: 3 },
        { entityId: "e-n1", gx: 6, gy: 4 },
        { entityId: "e-n2", gx: 7, gy: 4 },
      ],
      aoeTemplates: [], walls: [], fog: { enabled: false, revealed: [] },
    };
    await repo.put("maps", map);
  }

  // Ensure a Scene exists (also covers installs seeded before scenes were added).
  if (!(await repo.get("scenes", SCENE_ID))) {
    const scene: Scene = {
      collection: "scenes", id: SCENE_ID, campaignId: CAMPAIGN_ID, ownerId: OWNER,
      visibility: { kind: "party" }, createdAt: now, updatedAt: now, schemaVersion: 1,
      name: "Encounter", mapId: MAP_ID, participantEntityIds: [], round: 1,
    };
    await repo.put("scenes", scene);
  }
}

export default function App() {
  const ruleset = useMemo(() => getRuleset(DEMO_RULESET_ID), []);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void bootstrap(); }, []);

  const onExport = async () => {
    const backup = await exportCampaign(repo, CAMPAIGN_ID);
    downloadBackup(backup, `${CAMPAIGN_ID}-${new Date().toISOString().slice(0, 10)}.json`);
  };
  const onImportFile = async (file: File) => {
    try {
      const backup = JSON.parse(await file.text());
      await importCampaign(repo, backup);
    } catch (err) {
      alert("Import failed: the file is not a valid campaign backup.");
      console.error(err);
    }
  };

  const btn: CSSProperties = {
    background: "#1a1e29", border: "1px solid #2b3142", color: "#e9e3d4",
    borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0c11", color: "#e9e3d4", fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 18, color: "#d4af37", margin: 0, flex: 1 }}>Campaign Tracker — Combat module</h1>
        <button style={btn} onClick={onExport}>Export backup</button>
        <label style={btn}>
          Import backup
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ""; }} />
        </label>
      </div>
      <p style={{ fontSize: 12, color: "#99a0b0", maxWidth: 680 }}>
        This shell consumes the active <strong>{ruleset.meta.name}</strong> ruleset and a Repository.
        Initiative, conditions, sizes, distance and AoE geometry all come from the ruleset plugin — no game
        rules are hard-coded in the modules. Storage is local (IndexedDB) and persists across reloads; use
        Export/Import for backups. Open a second tab to see live cross-tab sync.
      </p>
      <MapView repo={repo} ruleset={ruleset} campaignId={CAMPAIGN_ID} mapId={MAP_ID} sceneId={SCENE_ID} ownerId={OWNER} />
      <CombatTracker repo={repo} ruleset={ruleset} campaignId={CAMPAIGN_ID} sceneId={SCENE_ID} ownerId={OWNER} />
    </div>
  );
}
