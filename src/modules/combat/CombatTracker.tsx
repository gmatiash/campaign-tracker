// src/modules/combat/CombatTracker.tsx
import { useEffect, useMemo, useState } from "react";
import type { Entity, Id, Scene } from "../../core/domain/domain";
import type { Asset } from "../../core/domain/map";
import { cloneEntity, createEntity } from "../../core/domain/factory";
import { fileToImageAsset } from "../../core/assets";
import type { Repository } from "../../core/persistence/repository";
import type { Ruleset } from "../../core/ruleset/ruleset";

const C = {
  panel: "#13161f", row: "#1a1e29", border: "#2b3142", text: "#e9e3d4",
  dim: "#99a0b0", gold: "#d4af37", pc: "#5b8def", npc: "#e07a3c", danger: "#d9544a",
};

const num = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Props {
  repo: Repository;
  ruleset: Ruleset;
  campaignId: Id;
  sceneId: Id;
  ownerId: Id;
}

/**
 * Combat module SHELL. No game rules are hard-coded: initiative, conditions and
 * sizes come from `ruleset`; all reads/writes go through `repo`. Round and active
 * turn live on the shared Scene record, so the map view reflects the same state.
 */
export default function CombatTracker({ repo, ruleset, campaignId, sceneId, ownerId }: Props) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [dmg, setDmg] = useState<Record<Id, string>>({});
  const [newName, setNewName] = useState("");

  useEffect(() => repo.subscribe<Entity>("entities", { campaignId }, setEntities), [repo, campaignId]);
  useEffect(() => repo.subscribe<Scene>("scenes", { campaignId }, setScenes), [repo, campaignId]);
  useEffect(() => repo.subscribe<Asset>("assets", { campaignId }, setAssets), [repo, campaignId]);

  const scene = useMemo(() => scenes.find((s) => s.id === sceneId) ?? null, [scenes, sceneId]);
  const round = scene?.round ?? 1;
  const activeId = scene?.activeEntityId ?? null;

  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a] as const)), [assets]);
  const portraitSrc = (e: Entity) =>
    e.portraitAssetId ? assetById.get(e.portraitAssetId)?.storageRef ?? null : null;

  const initOf = (e: Entity) => num(e.attributes.initiative);
  const ordered = useMemo(() => [...entities].sort((a, b) => initOf(b) - initOf(a)), [entities]);

  const save = (e: Entity, attrs: Record<string, unknown>, top: Partial<Entity> = {}) =>
    repo.put<Entity>("entities", { ...e, ...top, attributes: { ...e.attributes, ...attrs } });
  const saveScene = (patch: Partial<Scene>) => { if (scene) repo.put<Scene>("scenes", { ...scene, ...patch }); };

  const roll = (e: Entity) => save(e, { initiative: ruleset.rollInitiative(e) });
  const rollAllNpcs = () => ordered.filter((e) => e.kind === "npc").forEach(roll);

  const addCombatant = (kind: "pc" | "npc") => {
    const name = newName.trim() || (kind === "pc" ? "New PC" : "New NPC");
    repo.put("entities", createEntity({ campaignId, ownerId, ruleset, name, kind }));
    setNewName("");
  };
  const cloneNpc = (src: Entity) => {
    const base = src.name.replace(/\s*\d+$/, "").trim() || src.name;
    const re = new RegExp(`^${escapeRegExp(base)}\\s+(\\d+)$`);
    let max = 0;
    for (const e of entities) {
      if (e.name === base) max = Math.max(max, 1);
      const m = e.name.match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    repo.put("entities", cloneEntity(src, `${base} ${max + 1}`));
  };
  const removeEntity = (e: Entity) => {
    if (window.confirm(`Remove ${e.name} from the campaign?`)) repo.remove("entities", e.id);
  };
  const uploadPortrait = async (e: Entity, file: File) => {
    try {
      const asset = await fileToImageAsset(file, campaignId, e.ownerId);
      await repo.put<Asset>("assets", asset);
      save(e, {}, { portraitAssetId: asset.id });
    } catch (err) {
      console.error(err);
    }
  };

  const startTurns = () => saveScene({ round: 1, activeEntityId: ordered[0]?.id });
  const nextTurn = () => {
    if (!ordered.length || !scene) return;
    const i = ordered.findIndex((e) => e.id === activeId);
    if (i === -1) saveScene({ activeEntityId: ordered[0].id });
    else if (i + 1 >= ordered.length) saveScene({ activeEntityId: ordered[0].id, round: round + 1 });
    else saveScene({ activeEntityId: ordered[i + 1].id });
  };

  const toggle = (e: Entity, cond: string) => {
    const has = e.conditions.includes(cond);
    save(e, {}, { conditions: has ? e.conditions.filter((c) => c !== cond) : [...e.conditions, cond] });
  };
  const applyDmg = (e: Entity) => {
    const v = parseInt(dmg[e.id] ?? "", 10);
    if (!Number.isNaN(v)) save(e, { damage: Math.max(0, num(e.attributes.damage) + v) });
    setDmg((d) => ({ ...d, [e.id]: "" }));
  };

  const btn = (color: string) => ({
    background: C.row, border: `1px solid ${C.border}`, color, borderRadius: 6,
    padding: "5px 9px", fontSize: 12, fontWeight: 700, cursor: "pointer",
  });

  return (
    <div style={{ marginTop: 16, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ color: C.dim, fontSize: 12, fontWeight: 700 }}>ROUND</span>
        <span style={{ color: C.gold, fontSize: 22, fontWeight: 800 }}>{round}</span>
        <div style={{ flex: 1 }} />
        <button style={btn(C.text)} onClick={startTurns}>Start / Order</button>
        <button style={btn(C.gold)} onClick={rollAllNpcs}>Roll NPCs</button>
        <button style={{ ...btn(C.gold), background: C.gold, color: "#0a0c11" }} onClick={nextTurn}>Next turn</button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <input
          value={newName} placeholder="New combatant name…"
          onChange={(ev) => setNewName(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === "Enter") addCombatant("npc"); }}
          style={{ flex: 1, maxWidth: 260, background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 8px", fontSize: 12 }}
        />
        <button style={btn(C.pc)} onClick={() => addCombatant("pc")}>+ Add PC</button>
        <button style={btn(C.npc)} onClick={() => addCombatant("npc")}>+ Add NPC</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ordered.map((e) => {
          const active = e.id === activeId;
          const accent = e.color || (e.kind === "pc" ? C.pc : C.npc);
          const src = portraitSrc(e);
          return (
            <div key={e.id}
              style={{
                background: active ? "rgba(212,175,55,0.10)" : C.row,
                border: `1px solid ${active ? C.gold : C.border}`,
                borderLeft: `3px solid ${accent}`,
                borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label title="Set portrait"
                  style={{ width: 30, height: 30, flex: "0 0 auto", borderRadius: "50%", overflow: "hidden", cursor: "pointer", border: `1px solid ${C.border}`, background: accent, display: "flex", alignItems: "center", justifyContent: "center", color: "#0a0c11", fontWeight: 800, fontSize: 11 }}>
                  {src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(e.name)}
                  <input type="file" accept="image/*" style={{ display: "none" }}
                    onChange={(ev) => { const f = ev.target.files?.[0]; if (f) uploadPortrait(e, f); ev.target.value = ""; }} />
                </label>
                <input
                  type="number" value={initOf(e)} title="Initiative (editable)"
                  onChange={(ev) => save(e, { initiative: parseInt(ev.target.value, 10) || 0 })}
                  style={{ width: 40, background: C.panel, color: C.gold, fontWeight: 800, textAlign: "center", border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 2px" }}
                />
                <input
                  value={e.name} title="Rename"
                  onChange={(ev) => save(e, {}, { name: ev.target.value })}
                  style={{ flex: 1, background: "transparent", color: C.text, fontWeight: 800, fontSize: 14, border: "1px solid transparent", borderRadius: 5, padding: "2px 4px" }}
                  onFocus={(ev) => { ev.currentTarget.style.border = `1px solid ${C.border}`; ev.currentTarget.style.background = C.panel; }}
                  onBlur={(ev) => { ev.currentTarget.style.border = "1px solid transparent"; ev.currentTarget.style.background = "transparent"; }}
                />
                <span style={{ fontSize: 9, fontWeight: 800, color: accent, border: `1px solid ${accent}55`, borderRadius: 4, padding: "2px 5px" }}>
                  {e.kind.toUpperCase()}
                </span>
                <select
                  value={e.sizeId ?? "medium"}
                  onChange={(ev) => save(e, {}, { sizeId: ev.target.value })}
                  style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 11 }}
                >
                  {ruleset.sizes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                {e.kind === "npc" && <button style={btn(C.gold)} onClick={() => roll(e)}>Roll</button>}
                {e.kind === "npc" && <button style={btn(C.text)} title="Duplicate this NPC" onClick={() => cloneNpc(e)}>Clone</button>}
                <button style={{ ...btn(C.dim), padding: "5px 8px" }} title="Remove combatant" onClick={() => removeEntity(e)}>✕</button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span style={{ color: C.dim, fontWeight: 700 }}>Mod</span>
                <input
                  type="number" value={num(e.attributes.initiativeMod)}
                  onChange={(ev) => save(e, { initiativeMod: parseInt(ev.target.value, 10) || 0 })}
                  style={{ width: 48, background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 5px" }}
                />
                <span style={{ color: C.dim, fontWeight: 700, marginLeft: 8 }}>DMG</span>
                <span style={{ color: num(e.attributes.damage) > 0 ? C.danger : C.text, fontWeight: 800, minWidth: 22, textAlign: "center" }}>
                  {num(e.attributes.damage)}
                </span>
                <input
                  placeholder="+10 / -5" value={dmg[e.id] ?? ""}
                  onChange={(ev) => setDmg((d) => ({ ...d, [e.id]: ev.target.value }))}
                  onKeyDown={(ev) => { if (ev.key === "Enter") applyDmg(e); }}
                  style={{ width: 66, textAlign: "center", background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 5px" }}
                />
                <button style={btn(C.gold)} onClick={() => applyDmg(e)}>apply</button>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {ruleset.conditions.map((cond) => {
                  const on = e.conditions.includes(cond.id);
                  return (
                    <button
                      key={cond.id} title={cond.label} onClick={() => toggle(e, cond.id)}
                      style={{
                        fontSize: 10, fontWeight: 700, borderRadius: 5, padding: "2px 6px", cursor: "pointer",
                        background: on ? "rgba(212,175,55,0.18)" : "transparent",
                        border: `1px solid ${on ? C.gold : C.border}`,
                        color: on ? C.gold : C.dim,
                      }}
                    >
                      {cond.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
