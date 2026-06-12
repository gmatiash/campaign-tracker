// src/app/GmControl.tsx
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Repository } from "../core/persistence/repository";
import type { Entity, Id } from "../core/domain/domain";
import type { MapDoc } from "../core/domain/map";
import { partyRevealCells } from "../core/fog";

const C = {
  panel: "#12151d", row: "#1a1e29", border: "#2b3142",
  text: "#e9e3d4", dim: "#99a0b0", gold: "#d4af37", good: "#3fb950",
};

const card: CSSProperties = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 };
const h: CSSProperties = { color: C.gold, fontWeight: 800, fontSize: 13, margin: 0, textTransform: "uppercase", letterSpacing: 0.4 };
const bigBtn = (active = false, tone: string = C.text): CSSProperties => ({
  flex: 1, minWidth: 84, background: active ? "rgba(212,175,55,0.18)" : C.row,
  border: `1px solid ${active ? C.gold : C.border}`, color: active ? C.gold : tone,
  borderRadius: 10, padding: "12px 10px", fontSize: 15, fontWeight: 800, cursor: "pointer",
});

// Phone-friendly GM controls for the spatial, GM-only state (ambient light, fog,
// doors). Turn order and the editable token roster come from the CombatTracker
// rendered alongside this panel in control mode.
export default function GmControl({ repo, campaignId, mapId }: {
  repo: Repository; campaignId: Id; mapId: Id;
}) {
  const [maps, setMaps] = useState<MapDoc[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);

  useEffect(() => repo.subscribe<MapDoc>("maps", { campaignId }, setMaps), [repo, campaignId]);
  useEffect(() => repo.subscribe<Entity>("entities", { campaignId }, setEntities), [repo, campaignId]);

  const map = useMemo(() => maps.find((m) => m.id === mapId) ?? null, [maps, mapId]);
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e] as const)), [entities]);

  const saveMap = (patch: Partial<MapDoc>) => { if (map) repo.put<MapDoc>("maps", { ...map, ...patch, updatedAt: Date.now() }); };
  const setFog = (patch: Partial<NonNullable<MapDoc["fog"]>>) => {
    if (!map) return;
    const cur = map.fog ?? { enabled: false, revealed: [] };
    saveMap({ fog: { ...cur, ...patch } });
  };
  const updateWall = (id: Id, patch: Record<string, unknown>) =>
    map && saveMap({ walls: (map.walls ?? []).map((w) => (w.id === id ? { ...w, ...patch } : w)) });

  const cols = map ? Math.floor(map.width / map.grid.cellPx) : 0;
  const rows = map ? Math.floor(map.height / map.grid.cellPx) : 0;
  const revealAll = () => {
    const all: Array<[number, number]> = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) all.push([x, y]);
    setFog({ enabled: true, revealed: all });
  };
  const hideAll = () => setFog({ revealed: [] });

  // Drive line-of-sight fog from here (the phone), so the shared screen reveals
  // what the party sees as tokens move — no map tapping required.
  useEffect(() => {
    if (!map || !map.fog?.enabled || !map.fog?.los) return;
    const union = partyRevealCells(map, entityById);
    if (!union) return;
    const existing = new Set((map.fog.revealed ?? []).map(([x, y]) => `${x},${y}`));
    let added = false;
    for (const k of union) if (!existing.has(k)) { existing.add(k); added = true; }
    if (added) setFog({ revealed: [...existing].map((k) => { const [x, y] = k.split(",").map(Number); return [x, y] as [number, number]; }) });
  }, [map, entityById]);

  if (!map) return <div style={{ color: C.dim, padding: 16 }}>No map yet. Upload one from the full view first.</div>;

  const ambient = map.ambient ?? "dark";
  const fogOn = !!map.fog?.enabled;
  const doors = (map.walls ?? []).filter((w) => w.door);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520, margin: "0 auto" }}>
      {/* Ambient light */}
      <div style={card}>
        <h3 style={h}>Ambient light</h3>
        <div style={{ display: "flex", gap: 8 }}>
          {(["dark", "dim", "bright"] as const).map((a) => (
            <button key={a} style={bigBtn(ambient === a)} onClick={() => saveMap({ ambient: a })}>{a}</button>
          ))}
        </div>
      </div>

      {/* Fog of war */}
      <div style={card}>
        <h3 style={h}>Fog of war</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={bigBtn(fogOn)} onClick={() => setFog({ enabled: !fogOn })}>Fog {fogOn ? "on" : "off"}</button>
          <button style={bigBtn(!!map.fog?.los)} onClick={() => setFog({ enabled: map.fog?.los ? fogOn : true, los: !map.fog?.los })} title="Auto-reveal (and limit the player view to) what the party can see as tokens move">LoS fog {map.fog?.los ? "on" : "off"}</button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={bigBtn(false, C.dim)} onClick={revealAll}>Reveal all</button>
          <button style={bigBtn(false, C.dim)} onClick={hideAll}>Hide all</button>
        </div>
        <p style={{ color: C.dim, fontSize: 11, margin: 0 }}>With LoS fog on, the map reveals itself as the party moves on the shared screen. Use Hide all to reset between scenes.</p>
      </div>

      {/* Doors & secrets */}
      <div style={card}>
        <h3 style={h}>Doors &amp; secrets</h3>
        {doors.length === 0 && <span style={{ color: C.dim, fontSize: 12 }}>No doors on this map.</span>}
        {doors.map((w) => (
          <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, color: C.text, fontSize: 14 }}>
              {w.secret ? "🔒 Secret door" : "🚪 Door"} {w.label ?? "—"}
            </span>
            <button
              style={{ ...bigBtn(!!w.open, w.open ? C.good : C.text), flex: "0 0 auto", minWidth: 96 }}
              onClick={() => updateWall(w.id, { open: !w.open })}
            >
              {w.open ? "Open" : "Closed"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
