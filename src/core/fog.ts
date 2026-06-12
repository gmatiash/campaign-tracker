// src/core/fog.ts
import type { Entity, Id } from "./domain/domain";
import type { MapDoc } from "./domain/map";
import { computeLighting } from "./lighting";

/**
 * The set of cell keys ("x,y") that the party can currently SEE: the union of
 * every PC token's light/vision field of view, blocked by walls (open doors pass),
 * respecting the map's ambient light. Used by "LoS fog" to auto-reveal the map.
 *
 * Returns null when there is no usable grid or it's too large to compute cheaply.
 */
export function partyRevealCells(map: MapDoc, entityById: Map<Id, Entity>): Set<string> | null {
  const cols = Math.floor(map.width / map.grid.cellPx);
  const rows = Math.floor(map.height / map.grid.cellPx);
  if (cols * rows === 0 || cols * rows > 3000) return null;

  const ambient = map.ambient ?? "dark";
  const sources: Array<{ gx: number; gy: number; shape: "radial" | "cone"; brightFt: number; dir?: number }> = [];
  for (const L of map.lights ?? []) sources.push({ gx: L.gx, gy: L.gy, shape: L.shape, brightFt: L.brightFt, dir: L.dir });
  for (const t of map.tokens) {
    const e = entityById.get(t.entityId);
    const ft = Number(e?.attributes.lightFt) || 0;
    if (e && ft > 0) sources.push({ gx: t.gx, gy: t.gy, shape: e.attributes.lightCone ? "cone" : "radial", brightFt: ft, dir: Number(e.attributes.lightDir) || 0 });
  }
  const walls = (map.walls ?? [])
    .filter((w) => w.points.length >= 2 && !(w.door && w.open))
    .map((w) => [w.points[0], w.points[1]] as [[number, number], [number, number]]);

  const union = new Set<string>();
  for (const t of map.tokens) {
    const e = entityById.get(t.entityId);
    if (!e || e.kind !== "pc") continue;
    union.add(`${t.gx},${t.gy}`); // a token always knows its own square
    const seen = computeLighting({
      sources,
      viewer: { gx: t.gx, gy: t.gy, lowLight: !!e.attributes.lowLight, darkvisionFt: Number(e.attributes.darkvisionFt) || 0 },
      walls, cols, rows, cellFt: map.grid.cellFt, ambient,
    });
    for (const k of seen.keys()) union.add(k);
  }
  return union;
}

/**
 * The cells currently visible to players for rendering/list purposes:
 *  - null  → no fog, everything is visible
 *  - Set   → only these "x,y" cells are visible (LoS-current if los mode, else explored)
 */
export function playerVisibleCells(map: MapDoc, entityById: Map<Id, Entity>): Set<string> | null {
  if (!map.fog?.enabled) return null;
  if (map.fog.los) return partyRevealCells(map, entityById) ?? new Set();
  return new Set((map.fog.revealed ?? []).map(([x, y]) => `${x},${y}`));
}

/** Is an entity's token currently visible to players? Hidden creatures never are. */
export function entityVisibleToPlayers(e: Entity, map: MapDoc, visible: Set<string> | null): boolean {
  if (e.attributes.hidden) return false;
  const t = map.tokens.find((tk) => tk.entityId === e.id);
  if (!t) return true; // not on the map → not gated by fog
  if (!visible) return true; // no fog
  return visible.has(`${t.gx},${t.gy}`);
}
