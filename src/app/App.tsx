// src/app/App.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Campaign, Id, Scene } from "../core/domain/domain";
import type { Asset, MapDoc } from "../core/domain/map";
import { createEntity } from "../core/domain/factory";
import { removeImage } from "../core/assets";
import type { Repository } from "../core/persistence/repository";
import { IndexedDbRepository } from "../core/persistence/indexeddb/IndexedDbRepository";
import { SupabaseRepository } from "../core/persistence/supabase/SupabaseRepository";
import { isSupabaseConfigured, supabase } from "../core/persistence/supabase/supabaseClient";
import { exportCampaign, importCampaign, downloadBackup } from "../core/persistence/io";
import { getRuleset } from "../core/ruleset/ruleset";
import "../systems"; // registers all available rule systems
import CombatTracker from "../modules/combat/CombatTracker";
import { clearHistory } from "../modules/combat/turnHistory";
import MapView from "../modules/map/MapView";
import MembersPanel from "./MembersPanel";
import InvitePanel from "./InvitePanel";
import GuidePanel from "./GuidePanel";
import GmControl from "./GmControl";
import SignIn from "./auth/SignIn";
import { useSession } from "./auth/useSession";

const CAMPAIGN_ID: Id = "camp-1";
const MAP_ID: Id = "map-1";
const SCENE_ID: Id = "scene-1";
const DEMO_RULESET_ID = "dnd35"; // which system the demo campaign uses (config, not branding)
const LOCAL_OWNER: Id = "local-user";

// Cloud when Supabase is configured (then sign-in is required); otherwise local-first.
const cloud = isSupabaseConfigured && !!supabase;
const repo: Repository = cloud && supabase ? new SupabaseRepository(supabase) : new IndexedDbRepository();
const demoRuleset = getRuleset(DEMO_RULESET_ID);

// Build the demo content. Fixed ids, so re-running overwrites/restores cleanly.
async function seedDemo(ownerId: Id): Promise<void> {
  const now = Date.now();
  const campaign: Campaign = {
    collection: "campaigns", id: CAMPAIGN_ID, campaignId: CAMPAIGN_ID, ownerId,
    visibility: { kind: "party" }, createdAt: now, updatedAt: now, schemaVersion: 1,
    name: "Demo Campaign", rulesetId: DEMO_RULESET_ID,
    members: [{ userId: ownerId, role: "gm", displayName: "GM" }],
  };
  await repo.put("campaigns", campaign);
  const mk = (id: Id, name: string, kind: "pc" | "npc", sizeId: string, initiativeMod: number) =>
    createEntity({ campaignId: CAMPAIGN_ID, ownerId, ruleset: demoRuleset, id, name, kind, sizeId, initiativeMod });
  await repo.put("entities", mk("e-pc", "Mira Voss", "pc", "medium", 3));
  await repo.put("entities", mk("e-n1", "Raider 1", "npc", "small", 1));
  await repo.put("entities", mk("e-n2", "Raider 2", "npc", "small", 1));

  const map: MapDoc = {
    collection: "maps", id: MAP_ID, campaignId: CAMPAIGN_ID, ownerId,
    visibility: { kind: "party" }, createdAt: now, updatedAt: now, schemaVersion: 1,
    name: "Demo Map", width: 1600, height: 900,
    grid: { kind: demoRuleset.grid.kind, cellPx: 50, cellFt: demoRuleset.grid.cellFt, offsetX: 0, offsetY: 0, color: "rgba(212,175,55,0.35)" },
    tokens: [
      { entityId: "e-pc", gx: 3, gy: 3 },
      { entityId: "e-n1", gx: 6, gy: 4 },
      { entityId: "e-n2", gx: 7, gy: 4 },
    ],
    aoeTemplates: [], walls: [], fog: { enabled: false, revealed: [] },
  };
  await repo.put("maps", map);

  const scene: Scene = {
    collection: "scenes", id: SCENE_ID, campaignId: CAMPAIGN_ID, ownerId,
    visibility: { kind: "party" }, createdAt: now, updatedAt: now, schemaVersion: 1,
    name: "Encounter", mapId: MAP_ID, participantEntityIds: [], round: 1,
  };
  await repo.put("scenes", scene);
}

const WIPE_COLLECTIONS = ["entities", "maps", "scenes", "assets", "notes"] as const;

// Delete the campaign's working data and re-seed the demo.
async function resetToDemo(ownerId: Id): Promise<void> {
  for (const c of WIPE_COLLECTIONS) {
    const recs = await repo.list(c, { campaignId: CAMPAIGN_ID });
    for (const r of recs) {
      if (c === "assets") await removeImage(r as Asset);
      await repo.remove(c, r.id);
    }
  }
  clearHistory();
  await seedDemo(ownerId);
}

// Seed demo content once per owner, and never clobber existing data. In cloud
// mode the first member to join becomes GM and seeds; later members just read.
let bootstrappedFor = "";
async function bootstrap(ownerId: Id): Promise<void> {
  if (bootstrappedFor === ownerId) return;
  bootstrappedFor = ownerId;

  if (cloud && supabase) {
    const { error } = await supabase.rpc("ensure_membership", { cid: CAMPAIGN_ID });
    if (error) console.error("ensure_membership failed", error);
  }

  try {
    if (!(await repo.get("campaigns", CAMPAIGN_ID))) {
      await seedDemo(ownerId);
    } else if (!(await repo.get("scenes", SCENE_ID))) {
      // Older installs created before scenes existed.
      const now = Date.now();
      const scene: Scene = {
        collection: "scenes", id: SCENE_ID, campaignId: CAMPAIGN_ID, ownerId,
        visibility: { kind: "party" }, createdAt: now, updatedAt: now, schemaVersion: 1,
        name: "Encounter", mapId: MAP_ID, participantEntityIds: [], round: 1,
      };
      await repo.put("scenes", scene);
    }
  } catch (err) {
    // In cloud mode a non-GM member cannot seed; that's expected — they read what the GM created.
    console.warn("bootstrap seed skipped (likely a non-GM member):", err);
  }
}

const btnStyle: CSSProperties = {
  background: "#1a1e29", border: "1px solid #2b3142", color: "#e9e3d4",
  borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer",
};

function MainApp({ ownerId, userLabel, onSignOut }: { ownerId: Id; userLabel?: string; onSignOut?: () => void }) {
  const ruleset = useMemo(() => getRuleset(DEMO_RULESET_ID), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [isGm, setIsGm] = useState<boolean>(!cloud);
  const [showGuide, setShowGuide] = useState(false);
  const [controlMode, setControlMode] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      await bootstrap(ownerId);
      if (!cloud || !supabase) { if (alive) setIsGm(true); return; }
      const { data } = await supabase
        .from("campaign_members").select("role")
        .eq("campaign_id", CAMPAIGN_ID).eq("user_id", ownerId).maybeSingle();
      if (alive) setIsGm(data?.role === "gm");
    })();
    return () => { alive = false; };
  }, [ownerId]);

  const onExport = async () => {
    const backup = await exportCampaign(repo, CAMPAIGN_ID);
    downloadBackup(backup, `${CAMPAIGN_ID}-${new Date().toISOString().slice(0, 10)}.json`);
  };
  const onImportFile = async (file: File) => {
    try {
      await importCampaign(repo, JSON.parse(await file.text()));
    } catch (err) {
      alert("Import failed: the file is not a valid campaign backup.");
      console.error(err);
    }
  };
  const onReset = async () => {
    const msg = cloud
      ? "Reset the shared campaign to the demo for EVERYONE? This deletes all current combatants, maps, scenes and uploaded images."
      : "Reset to the demo? This clears your local combatants, maps, scenes and uploaded images.";
    if (!window.confirm(msg)) return;
    if (cloud && supabase) {
      const { data } = await supabase.from("campaign_members").select("role").eq("campaign_id", CAMPAIGN_ID).eq("user_id", ownerId).maybeSingle();
      if (data?.role !== "gm") { alert("Only the GM can reset the campaign."); return; }
    }
    try {
      const prevMap = await repo.get<MapDoc>("maps", MAP_ID).catch(() => null);
      const wasLos = !!prevMap?.fog?.los;
      await resetToDemo(ownerId);
      if (wasLos) {
        const m = await repo.get<MapDoc>("maps", MAP_ID).catch(() => null);
        if (m) await repo.put<MapDoc>("maps", { ...m, fog: { enabled: true, revealed: [], los: true }, updatedAt: Date.now() });
      }
    }
    catch (err) { alert("Reset failed."); console.error(err); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0c11", color: "#e9e3d4", fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 18, color: "#d4af37", margin: 0, flex: 1 }}>Campaign Tracker — Combat module</h1>
        <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 999, background: cloud ? "rgba(91,141,239,0.18)" : "rgba(153,160,176,0.15)", color: cloud ? "#5b8def" : "#99a0b0", border: `1px solid ${cloud ? "#5b8def66" : "#2b3142"}` }}>
          {cloud ? "CLOUD" : "LOCAL"}
        </span>
        {userLabel && <span style={{ fontSize: 11, color: "#99a0b0" }}>{userLabel}</span>}
        {isGm && <button style={{ ...btnStyle, ...(controlMode ? { color: "#d4af37", borderColor: "#d4af37" } : {}) }} onClick={() => setControlMode((v) => !v)} title="A phone-friendly control surface for running combat while the map is shared from another screen.">{controlMode ? "Exit control" : "GM Control"}</button>}
        <button style={{ ...btnStyle, color: "#d4af37", borderColor: "#d4af3766" }} onClick={() => setShowGuide(true)}>Guide</button>
        {!controlMode && <button style={btnStyle} onClick={onExport}>Export backup</button>}
        {!controlMode && <label style={btnStyle}>
          Import backup
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ""; }} />
        </label>}
        {!controlMode && <button style={{ ...btnStyle, color: "#d9544a" }} onClick={onReset}>Reset to demo</button>}
        {cloud && !controlMode && <InvitePanel />}
        {onSignOut && <button style={btnStyle} onClick={onSignOut}>Sign out</button>}
      </div>
      {controlMode ? (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 12, color: "#99a0b0", maxWidth: 520, margin: "0 auto 12px" }}>
            Run combat from here while the map is shared from another screen (sign that screen in as a player and use <strong>View as player</strong>). Changes sync live.
          </p>
          <GmControl repo={repo} campaignId={CAMPAIGN_ID} mapId={MAP_ID} />
          <div style={{ maxWidth: 520, margin: "12px auto 0" }}>
            <CombatTracker repo={repo} ruleset={ruleset} campaignId={CAMPAIGN_ID} sceneId={SCENE_ID} ownerId={ownerId} mapId={MAP_ID} isGm={isGm} />
          </div>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "#99a0b0", maxWidth: 700 }}>
            This shell consumes the active <strong>{ruleset.meta.name}</strong> ruleset and a Repository. No game
            rules are hard-coded in the modules. {cloud
              ? "Storage is cloud (Supabase) with realtime sync and row-level security; the first member to join a campaign is its GM."
              : "Storage is local (IndexedDB) and persists across reloads; use Export/Import for backups."}
          </p>
          {cloud && <MembersPanel campaignId={CAMPAIGN_ID} currentUserId={ownerId} />}
          <MapView repo={repo} ruleset={ruleset} campaignId={CAMPAIGN_ID} mapId={MAP_ID} sceneId={SCENE_ID} isGm={isGm} />
          <CombatTracker repo={repo} ruleset={ruleset} campaignId={CAMPAIGN_ID} sceneId={SCENE_ID} ownerId={ownerId} mapId={MAP_ID} isGm={isGm} />
        </>
      )}
      {showGuide && <GuidePanel isGm={isGm} onClose={() => setShowGuide(false)} />}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#0a0c11", color: "#99a0b0", fontFamily: "system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {children}
    </div>
  );
}

function CloudApp() {
  const { session, loading } = useSession();
  if (loading) return <Centered>Loading…</Centered>;
  if (!session) return <SignIn />;
  return (
    <MainApp
      ownerId={session.user.id}
      userLabel={session.user.email ?? "signed in"}
      onSignOut={() => void supabase?.auth.signOut()}
    />
  );
}

export default function App() {
  return cloud ? <CloudApp /> : <MainApp ownerId={LOCAL_OWNER} />;
}
