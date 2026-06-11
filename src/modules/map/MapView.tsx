// src/modules/map/MapView.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as RPointerEvent, WheelEvent as RWheelEvent } from "react";
import type { Campaign, Entity, Id, Scene } from "../../core/domain/domain";
import { fileToImageAsset, removeImage } from "../../core/assets";
import { detectGrid } from "../../core/gridDetect";
import type { AoeTemplate, Asset, GridConfig, MapDoc, Wall, LightSource } from "../../core/domain/map";
import { computeLighting } from "../../core/lighting";
import type { Repository } from "../../core/persistence/repository";
import type { AoeShape, Dir8, Ruleset } from "../../core/ruleset/ruleset";
import type { DistanceUnit } from "../../core/units";
import { formatDistance } from "../../core/units";

const C = {
  bg: "#0a0c11", panel: "#13161f", row: "#1a1e29", border: "#2b3142",
  text: "#e9e3d4", dim: "#99a0b0", gold: "#d4af37", pc: "#5b8def", npc: "#e07a3c", danger: "#d9544a",
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

function hexToRgba(hex: string, a: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Preset AoE/terrain visuals — a CSS background per cell, tinted at the template's opacity.
type EffectKind = "fire" | "ice" | "mud" | "fog" | "water" | "acid" | "custom";
const EFFECT_PRESETS: Array<{ kind: Exclude<EffectKind, "custom">; label: string }> = [
  { kind: "fire", label: "Fire" },
  { kind: "water", label: "Water" },
  { kind: "mud", label: "Mud" },
  { kind: "fog", label: "Mist" },
  { kind: "ice", label: "Ice" },
  { kind: "acid", label: "Acid" },
];
function effectFill(kind: EffectKind, opacity: number): string {
  const a = Math.min(0.95, opacity + 0.15); // a touch stronger than a flat tint so it reads
  switch (kind) {
    case "fire": return `radial-gradient(circle at 50% 70%, rgba(255,196,72,${a}), rgba(214,64,18,${a}))`;
    case "water": return `rgba(46,118,206,${a})`;
    case "mud": return `rgba(104,76,44,${a})`;
    case "fog": return `rgba(222,228,236,${a})`;
    case "ice": return `linear-gradient(135deg, rgba(190,228,255,${a}), rgba(120,178,236,${a}))`;
    case "acid": return `rgba(126,200,64,${a})`;
    default: return `rgba(120,120,120,${a})`;
  }
}

const DIR_ARROW: Record<Dir8, string> = { N: "\u2191", NE: "\u2197", E: "\u2192", SE: "\u2198", S: "\u2193", SW: "\u2199", W: "\u2190", NW: "\u2196" };
const DIR_ANGLE: Record<Dir8, number> = { E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225, N: 270, NE: 315 };
const COMPASS: (Dir8 | null)[] = ["NW", "N", "NE", "W", null, "E", "SW", "S", "SE"];

interface PlacedToken { entityId: Id; gx: number; gy: number; footprint: number; spaceFt: number; scale: number; }
interface Placement { dx: number; dy: number; z: number; }

/**
 * Resolve how tokens sharing a cell are drawn:
 *  - larger creatures sit on a LOWER layer than smaller ones (smaller render on top);
 *  - sub-Small creatures (scale < 1) pack into their size's sub-grid (Tiny 2x2,
 *    Diminutive 5x5, Fine 10x10) so several fit one square;
 *  - same-square Small+ tokens fan diagonally so each stays partly visible.
 */
function computePlacements(items: PlacedToken[], cellPx: number): Map<string, Placement> {
  const byCell = new Map<string, PlacedToken[]>();
  for (const it of items) {
    const k = `${it.gx},${it.gy}`;
    const arr = byCell.get(k);
    if (arr) arr.push(it); else byCell.set(k, [it]);
  }
  const out = new Map<string, Placement>();
  for (const group of byCell.values()) {
    const sorted = [...group].sort((a, b) => b.spaceFt - a.spaceFt); // largest first → lowest z
    const subCounter = new Map<number, number>();
    let fan = 0;
    sorted.forEach((it, i) => {
      let dx = 0, dy = 0;
      if (it.scale < 1) {
        const subN = Math.max(1, Math.round(1 / it.scale));
        const n = subCounter.get(subN) ?? 0;
        subCounter.set(subN, n + 1);
        const sub = cellPx / subN;
        const col = n % subN, row = Math.floor(n / subN);
        dx = (col + 0.5) * sub - cellPx / 2;
        dy = (row + 0.5) * sub - cellPx / 2;
      } else if (group.length > 1) {
        const step = Math.min(cellPx * 0.18, 16);
        dx = fan * step; dy = fan * step; fan++;
      }
      out.set(it.entityId, { dx, dy, z: 20 + i });
    });
  }
  return out;
}

interface View { scale: number; tx: number; ty: number; }
interface DragState { entityId: Id; footprint: number; baseGx: number; baseGy: number; startX: number; startY: number; startScale: number; }
interface TplDrag { id: Id; baseIX: number; baseIY: number; startX: number; startY: number; startScale: number; }

interface Props {
  repo: Repository;
  ruleset: Ruleset;
  campaignId: Id;
  mapId: Id;
  sceneId: Id;
  isGm?: boolean; // GM sees fog/wall tools and the full map; players see only revealed areas
  distanceUnit?: DistanceUnit; // [future] driven by Campaign.settings.distanceUnit
}

/**
 * Battle-map view (slice 2: grid + tokens + AoE templates + reach overlay).
 * No game rules live here: grid kind/cell distance, token sizes, reach squares
 * and AoE cell geometry all come from the active ruleset. Distances render via
 * formatDistance(), so the ft<->m unit hook is already wired.
 */
export default function MapView({ repo, ruleset, campaignId, mapId, sceneId, isGm = true, distanceUnit = "ft" }: Props) {
  const [maps, setMaps] = useState<MapDoc[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragCell, setDragCell] = useState<{ gx: number; gy: number } | null>(null);
  const [dragPath, setDragPath] = useState<{ cells: Array<[number, number]>; blocked: boolean } | null>(null);
  const [selected, setSelected] = useState<Id | null>(null);
  const [selTpl, setSelTpl] = useState<Id | null>(null);
  const [tplDrag, setTplDrag] = useState<TplDrag | null>(null);
  const [tplOrigin, setTplOrigin] = useState<{ ix: number; iy: number } | null>(null);
  const [showReach, setShowReach] = useState(false);
  const [fogTool, setFogTool] = useState<"off" | "reveal" | "hide" | "room" | "wall" | "door">("off");
  const [roomMode, setRoomMode] = useState<"reveal" | "hide">("reveal");
  const [viewAsPlayer, setViewAsPlayer] = useState(false);
  const [showLight, setShowLight] = useState(false);
  const [selLight, setSelLight] = useState<Id | null>(null);
  const [lightDrag, setLightDrag] = useState<{ id: Id; baseGx: number; baseGy: number; startX: number; startY: number; startScale: number } | null>(null);
  const [lightPos, setLightPos] = useState<{ gx: number; gy: number } | null>(null);
  const [boxRect, setBoxRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const boxStartRef = useRef<{ gx: number; gy: number } | null>(null);
  const wallStartRef = useRef<{ ix: number; iy: number } | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => repo.subscribe<MapDoc>("maps", { campaignId }, setMaps), [repo, campaignId]);
  useEffect(() => repo.subscribe<Entity>("entities", { campaignId }, setEntities), [repo, campaignId]);
  useEffect(() => repo.subscribe<Asset>("assets", { campaignId }, setAssets), [repo, campaignId]);
  useEffect(() => repo.subscribe<Scene>("scenes", { campaignId }, setScenes), [repo, campaignId]);
  useEffect(() => repo.subscribe<Campaign>("campaigns", { campaignId }, setCampaigns), [repo, campaignId]);

  const map = useMemo(() => maps.find((m) => m.id === mapId) ?? null, [maps, mapId]);
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e] as const)), [entities]);
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a] as const)), [assets]);
  const activeId = useMemo(() => scenes.find((s) => s.id === sceneId)?.activeEntityId ?? null, [scenes, sceneId]);
  const campaign = useMemo(() => campaigns.find((c) => c.id === campaignId) ?? null, [campaigns, campaignId]);
  const unit: DistanceUnit = campaign?.settings?.distanceUnit ?? distanceUnit;
  const bgSrc = useMemo(() => {
    if (!map?.backgroundAssetId) return null;
    return assetById.get(map.backgroundAssetId)?.storageRef ?? null;
  }, [map, assetById]);

  const sizeOf = (e: Entity) =>
    ruleset.sizes.find((s) => s.id === (e.sizeId ?? "medium")) ??
    { id: "medium", label: "Medium", footprint: 1, spaceFt: 5, reachFt: 5, scale: 1 };

  // ---- persistence helpers -------------------------------------------------
  const saveMap = (patch: Partial<MapDoc>) => {
    if (!map) return;
    repo.put<MapDoc>("maps", { ...map, ...patch, updatedAt: Date.now() });
  };
  const setGrid = (patch: Partial<GridConfig>) => map && saveMap({ grid: { ...map.grid, ...patch } });
  const saveUnit = (u: DistanceUnit) => { if (campaign) repo.put<Campaign>("campaigns", { ...campaign, settings: { ...campaign.settings, distanceUnit: u }, updatedAt: Date.now() }); };
  const moveToken = (entityId: Id, gx: number, gy: number) =>
    map && saveMap({ tokens: map.tokens.map((t) => (t.entityId === entityId ? { ...t, gx, gy } : t)) });
  const removeToken = (entityId: Id) =>
    map && saveMap({ tokens: map.tokens.filter((t) => t.entityId !== entityId) });

  const placeToken = (entityId: Id) => {
    if (!map) return;
    const cols = Math.max(1, Math.floor(map.width / map.grid.cellPx));
    const occ = new Set(map.tokens.map((t) => `${t.gx},${t.gy}`));
    let cell = { gx: 0, gy: 0 };
    outer: for (let gy = 0; gy < 200; gy++)
      for (let gx = 0; gx < cols; gx++)
        if (!occ.has(`${gx},${gy}`)) { cell = { gx, gy }; break outer; }
    saveMap({ tokens: [...map.tokens, { entityId, gx: cell.gx, gy: cell.gy }] });
  };

  // ---- AoE templates -------------------------------------------------------
  const addTemplate = (shape: AoeShape) => {
    if (!map) return;
    const ix = Math.round(map.width / map.grid.cellPx / 2);
    const iy = Math.round(map.height / map.grid.cellPx / 2);
    const t: AoeTemplate = {
      id: uid(), shape, originIX: ix, originIY: iy,
      sizeFt: shape === "burst" ? 20 : 30, dir: "E", angleDeg: shape === "burst" ? undefined : 0,
      color: "#e6c84f", opacity: 0.32,
    };
    saveMap({ aoeTemplates: [...map.aoeTemplates, t] });
    setSelTpl(t.id); setSelected(null);
  };
  const updateTpl = (id: Id, patch: Partial<AoeTemplate>) =>
    map && saveMap({ aoeTemplates: map.aoeTemplates.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const removeTpl = (id: Id) => { if (map) saveMap({ aoeTemplates: map.aoeTemplates.filter((t) => t.id !== id) }); setSelTpl(null); };

  // Set a template's effect (preset or none), cleaning up a replaced custom image.
  const setTplEffect = async (t: AoeTemplate, effect: AoeTemplate["effect"]) => {
    updateTpl(t.id, { effect });
    const prev = t.effect;
    if (prev?.kind === "custom" && prev.assetId && effect?.kind !== "custom") {
      await removeImage(await repo.get<Asset>("assets", prev.assetId));
      await repo.remove("assets", prev.assetId).catch(() => undefined);
    }
  };
  // Upload a custom image to tile (semi-transparently) across the affected cells.
  const uploadEffectImage = async (t: AoeTemplate, file: File) => {
    if (!map) return;
    try {
      const prev = t.effect;
      const asset = await fileToImageAsset(file, campaignId, map.ownerId);
      await repo.put<Asset>("assets", asset);
      updateTpl(t.id, { effect: { kind: "custom", assetId: asset.id } });
      if (prev?.kind === "custom" && prev.assetId) {
        await removeImage(await repo.get<Asset>("assets", prev.assetId));
        await repo.remove("assets", prev.assetId).catch(() => undefined);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // ---- light sources + vision ----------------------------------------------
  const setEntityAttr = (e: Entity, patch: Record<string, unknown>) =>
    repo.put<Entity>("entities", { ...e, attributes: { ...e.attributes, ...patch }, updatedAt: Date.now() });
  const addLight = () => {
    if (!map) return;
    const cols = Math.max(1, Math.floor(map.width / map.grid.cellPx)), rows = Math.max(1, Math.floor(map.height / map.grid.cellPx));
    const L: LightSource = { id: uid(), gx: Math.floor(cols / 2), gy: Math.floor(rows / 2), shape: "radial", brightFt: 20, color: "#f5a623" };
    saveMap({ lights: [...(map.lights ?? []), L] });
    setSelLight(L.id); setSelected(null); setSelTpl(null);
  };
  const updateLight = (id: Id, patch: Partial<LightSource>) =>
    map && saveMap({ lights: (map.lights ?? []).map((L) => (L.id === id ? { ...L, ...patch } : L)) });
  const removeLight = (id: Id) => { if (map) saveMap({ lights: (map.lights ?? []).filter((L) => L.id !== id) }); setSelLight(null); };

  // ---- background upload ---------------------------------------------------
  const loadImageFile = async (file: File) => {
    if (!map) return;
    try {
      const prevId = map.backgroundAssetId;
      const asset = await fileToImageAsset(file, campaignId, map.ownerId);
      const guess = await detectGrid(file).catch(() => null);
      const gridPatch = (() => {
        if (!guess) return {};
        const cell = clamp(Math.round(guess.cellPx), 16, 200);
        const wrap = (v: number) => ((Math.round(v) % cell) + cell) % cell;
        return { cellPx: cell, offsetX: wrap(guess.offsetX), offsetY: wrap(guess.offsetY) };
      })();
      if (guess) console.info(`[grid] auto-detected cell ≈ ${Math.round(guess.cellPx)}px (confidence ${guess.confidence.toFixed(2)}). Fine-tune with the Cell / Off sliders if needed.`);
      else console.info("[grid] no clear grid found in the image — set the cell size manually with the sliders.");
      await repo.put<Asset>("assets", asset);
      saveMap({ backgroundAssetId: asset.id, width: asset.width, height: asset.height, grid: { ...map.grid, ...gridPatch } });
      if (prevId) {
        await removeImage(await repo.get<Asset>("assets", prevId));
        await repo.remove("assets", prevId).catch(() => undefined);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // ---- view: zoom / pan / fit ---------------------------------------------
  const fit = () => {
    if (!map || !viewportRef.current) return;
    const vp = viewportRef.current.getBoundingClientRect();
    const scale = Math.min(vp.width / map.width, vp.height / map.height) * 0.98;
    setView({ scale, tx: (vp.width - map.width * scale) / 2, ty: (vp.height - map.height * scale) / 2 });
  };
  useEffect(() => { fit(); }, [map?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onWheel = (e: RWheelEvent<HTMLDivElement>) => {
    if (!viewportRef.current) return;
    const vp = viewportRef.current.getBoundingClientRect();
    const px = e.clientX - vp.left, py = e.clientY - vp.top;
    setView((v) => {
      const next = clamp(v.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.2, 6);
      const wx = (px - v.tx) / v.scale, wy = (py - v.ty) / v.scale;
      return { scale: next, tx: px - wx * next, ty: py - wy * next };
    });
  };

  const onCanvasPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    setSelected(null); setSelTpl(null);
    panRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onCanvasPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return;
    const dx = e.clientX - panRef.current.x, dy = e.clientY - panRef.current.y;
    panRef.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const endPan = () => { panRef.current = null; };

  // ---- fog of war + walls --------------------------------------------------
  // NOTE: this is CLIENT-SIDE fog. The fog/wall data lives in the shared MapDoc,
  // so every client receives it; players simply don't *render* hidden areas (and
  // hidden tokens aren't drawn). For a screen-shared game (GM "View as player")
  // this is total. For players on their own devices it's presentational, not
  // cryptographic secrecy — true secrecy needs server-side per-player filtering
  // (Realtime Authorization / GM-only records), noted as future hardening.
  const fog = map?.fog ?? { enabled: false, revealed: [] as Array<[number, number]> };
  const gridDims = () => (map ? { cols: Math.floor(map.width / map.grid.cellPx), rows: Math.floor(map.height / map.grid.cellPx) } : { cols: 0, rows: 0 });

  const revealedSet = useMemo(
    () => new Set((map?.fog?.revealed ?? []).map(([x, y]) => `${x},${y}`)),
    [map?.fog?.revealed]
  );
  const isRevealed = (gx: number, gy: number) => revealedSet.has(`${gx},${gy}`);

  // Wall edges keyed as "H:ix:iy" (top edge of cell ix,iy) or "V:ix:iy" (left edge).
  const wallEdge = (a: [number, number], b: [number, number]): string | null => {
    const [ax, ay] = a, [bx, by] = b;
    if (ay === by && Math.abs(ax - bx) === 1) return `H:${Math.min(ax, bx)}:${ay}`;
    if (ax === bx && Math.abs(ay - by) === 1) return `V:${ax}:${Math.min(ay, by)}`;
    return null;
  };
  const wallSet = useMemo(() => {
    const s = new Set<string>();
    for (const w of map?.walls ?? []) {
      for (let i = 0; i + 1 < w.points.length; i++) { const k = wallEdge(w.points[i], w.points[i + 1]); if (k) s.add(k); }
    }
    return s;
  }, [map?.walls]);

  // Edges that block MOVEMENT: walls, but not doors (you can walk through a door).
  const moveBlocked = useMemo(() => {
    const s = new Set<string>();
    for (const w of map?.walls ?? []) {
      if (w.door) continue;
      for (let i = 0; i + 1 < w.points.length; i++) { const k = wallEdge(w.points[i], w.points[i + 1]); if (k) s.add(k); }
    }
    return s;
  }, [map?.walls]);

  const PATH_LIMIT = 4000; // skip pathfinding on very large grids (perf)
  const stepAllowed = (x: number, y: number, nx: number, ny: number): boolean => {
    const dx = nx - x, dy = ny - y;
    if (dx && dy) {
      const v = dx > 0 ? `V:${x + 1}:${y}` : `V:${x}:${y}`;
      const h = dy > 0 ? `H:${x}:${y + 1}` : `H:${x}:${y}`;
      return !moveBlocked.has(v) && !moveBlocked.has(h); // no cutting wall corners
    }
    if (dx) return !moveBlocked.has(dx > 0 ? `V:${x + 1}:${y}` : `V:${x}:${y}`);
    return !moveBlocked.has(dy > 0 ? `H:${x}:${y + 1}` : `H:${x}:${y}`);
  };
  // Shortest grid path that never crosses a wall (doors pass). Dijkstra, 8-way,
  // orthogonal cost 10 / diagonal 14. Returns cells start..target, or null.
  const findPath = (sx: number, sy: number, tx: number, ty: number, cols: number, rows: number): Array<[number, number]> | null => {
    if (sx === tx && sy === ty) return [[sx, sy]];
    const N = cols * rows, idx = (x: number, y: number) => y * cols + x;
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    const heap: number[] = [];
    const up = (i: number) => { while (i > 0) { const p = (i - 1) >> 1; if (dist[heap[p]] <= dist[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const down = (i: number) => { for (;;) { const l = 2 * i + 1, r = 2 * i + 2; let m = i; if (l < heap.length && dist[heap[l]] < dist[heap[m]]) m = l; if (r < heap.length && dist[heap[r]] < dist[heap[m]]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } };
    const push = (n: number) => { heap.push(n); up(heap.length - 1); };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; down(0); } return top; };
    const target = idx(tx, ty);
    dist[idx(sx, sy)] = 0; push(idx(sx, sy));
    const DIRS = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];
    while (heap.length) {
      const u = pop();
      if (done[u]) continue;
      done[u] = 1;
      if (u === target) break;
      const ux = u % cols, uy = (u / cols) | 0, du = dist[u];
      for (const [dx, dy, w] of DIRS) {
        const nx = ux + dx, ny = uy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (!stepAllowed(ux, uy, nx, ny)) continue;
        const v = idx(nx, ny), nd = du + w;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(v); }
      }
    }
    if (dist[target] === Infinity) return null;
    const path: Array<[number, number]> = [];
    for (let cur = target; cur !== -1; cur = prev[cur]) path.push([cur % cols, (cur / cols) | 0]);
    return path.reverse();
  };
  // 3.5e distance along a path (orthogonal = 1 square; diagonals alternate 1,2,…).
  const pathDistanceFt = (cells: Array<[number, number]>, cellFt: number): number => {
    let orth = 0, diag = 0;
    for (let i = 1; i < cells.length; i++) {
      const dx = Math.abs(cells[i][0] - cells[i - 1][0]), dy = Math.abs(cells[i][1] - cells[i - 1][1]);
      if (dx && dy) diag++; else orth++;
    }
    return (orth + diag + Math.floor(diag / 2)) * cellFt;
  };

  const toWorld = (clientX: number, clientY: number) => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp || !map) return null;
    return { wx: (clientX - vp.left - view.tx) / view.scale - map.grid.offsetX, wy: (clientY - vp.top - view.ty) / view.scale - map.grid.offsetY };
  };
  const pointToCell = (cx: number, cy: number) => {
    const w = toWorld(cx, cy); if (!w || !map) return null;
    return { gx: Math.floor(w.wx / map.grid.cellPx), gy: Math.floor(w.wy / map.grid.cellPx) };
  };
  const pointToIntersection = (cx: number, cy: number) => {
    const w = toWorld(cx, cy); if (!w || !map) return null;
    return { ix: Math.round(w.wx / map.grid.cellPx), iy: Math.round(w.wy / map.grid.cellPx) };
  };

  const setFog = (patch: Partial<{ enabled: boolean; revealed: Array<[number, number]> }>) => {
    if (!map) return;
    const cur = map.fog ?? { enabled: false, revealed: [] as Array<[number, number]> };
    saveMap({ fog: { enabled: cur.enabled, revealed: cur.revealed, ...patch } });
  };
  const fromKeys = (set: Set<string>): Array<[number, number]> => [...set].map((k) => k.split(",").map(Number) as [number, number]);

  // Reveal/Hide by dragging a rectangle (box) over cells.
  const applyBox = (a: { gx: number; gy: number }, b: { gx: number; gy: number }, mode: "reveal" | "hide") => {
    if (!map) return;
    const { cols, rows } = gridDims();
    const x0 = clamp(Math.min(a.gx, b.gx), 0, cols - 1), x1 = clamp(Math.max(a.gx, b.gx), 0, cols - 1);
    const y0 = clamp(Math.min(a.gy, b.gy), 0, rows - 1), y1 = clamp(Math.max(a.gy, b.gy), 0, rows - 1);
    const set = new Set((map.fog?.revealed ?? []).map(([x, y]) => `${x},${y}`));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const k = `${x},${y}`; if (mode === "reveal") set.add(k); else set.delete(k); }
    setFog({ enabled: true, revealed: fromKeys(set) });
  };
  const revealAll = () => {
    const { cols, rows } = gridDims();
    const all: Array<[number, number]> = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) all.push([x, y]);
    setFog({ enabled: true, revealed: all });
  };
  const hideAll = () => setFog({ enabled: true, revealed: [] });

  // Flood-fill a whole "room" (bounded by walls/doors) and reveal or hide it.
  const floodRoom = (sx: number, sy: number, mode: "reveal" | "hide") => {
    if (!map) return;
    const { cols, rows } = gridDims();
    if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) return;
    const seen = new Set<string>([`${sx},${sy}`]);
    const stack: Array<[number, number]> = [[sx, sy]];
    const step = (nx: number, ny: number, edge: string) => {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || wallSet.has(edge)) return;
      const k = `${nx},${ny}`;
      if (!seen.has(k)) { seen.add(k); stack.push([nx, ny]); }
    };
    while (stack.length) {
      const [x, y] = stack.pop()!;
      step(x + 1, y, `V:${x + 1}:${y}`);
      step(x - 1, y, `V:${x}:${y}`);
      step(x, y + 1, `H:${x}:${y + 1}`);
      step(x, y - 1, `H:${x}:${y}`);
    }
    const set = new Set((map.fog?.revealed ?? []).map(([x, y]) => `${x},${y}`));
    for (const k of seen) { if (mode === "reveal") set.add(k); else set.delete(k); }
    setFog({ enabled: true, revealed: fromKeys(set) });
  };

  const addWallLine = (a: { ix: number; iy: number }, b: { ix: number; iy: number }) => {
    if (!map) return;
    const edges: Array<[[number, number], [number, number]]> = [];
    if (a.iy === b.iy && a.ix !== b.ix) { const y = a.iy; for (let x = Math.min(a.ix, b.ix); x < Math.max(a.ix, b.ix); x++) edges.push([[x, y], [x + 1, y]]); }
    else if (a.ix === b.ix && a.iy !== b.iy) { const x = a.ix; for (let yy = Math.min(a.iy, b.iy); yy < Math.max(a.iy, b.iy); yy++) edges.push([[x, yy], [x, yy + 1]]); }
    else return;
    const have = new Set((map.walls ?? []).map((w) => wallEdge(w.points[0], w.points[1])).filter(Boolean) as string[]);
    const additions: Wall[] = [];
    for (const [p, q] of edges) {
      const k = wallEdge(p, q);
      if (k && !have.has(k)) { have.add(k); additions.push({ id: uid(), points: [p, q], blocksMovement: true, blocksLight: true, blocksLineOfSight: true, blocksEffect: false }); }
    }
    if (additions.length) saveMap({ walls: [...(map.walls ?? []), ...additions] });
  };
  const removeWallNear = (cx: number, cy: number) => {
    if (!map) return;
    const w = toWorld(cx, cy); if (!w) return;
    const wx = w.wx + map.grid.offsetX, wy = w.wy + map.grid.offsetY;
    let best: Id | null = null, bestD = Infinity;
    for (const wall of map.walls ?? []) {
      const [[ax, ay], [bx, by]] = [wall.points[0], wall.points[1]];
      const mx = map.grid.offsetX + ((ax + bx) / 2) * map.grid.cellPx;
      const my = map.grid.offsetY + ((ay + by) / 2) * map.grid.cellPx;
      const d = (mx - wx) ** 2 + (my - wy) ** 2;
      if (d < bestD) { bestD = d; best = wall.id; }
    }
    if (best && bestD < (map.grid.cellPx * 0.6) ** 2) saveMap({ walls: (map.walls ?? []).filter((wl) => wl.id !== best) });
  };

  // Nearest cell edge to a grid-relative world point (for door placement).
  const nearestEdge = (gx: number, gy: number): { key: string; points: [[number, number], [number, number]] } => {
    const ux = gx / (map?.grid.cellPx ?? 1), uy = gy / (map?.grid.cellPx ?? 1);
    const dV = Math.abs(ux - Math.round(ux)), dH = Math.abs(uy - Math.round(uy));
    if (dV <= dH) { const ix = Math.round(ux), iy = Math.floor(uy); return { key: `V:${ix}:${iy}`, points: [[ix, iy], [ix, iy + 1]] }; }
    const iy = Math.round(uy), ix = Math.floor(ux);
    return { key: `H:${ix}:${iy}`, points: [[ix, iy], [ix + 1, iy]] };
  };
  // Door = a wall edge flagged as a door: it still blocks the fog flood, but is
  // shown to players when an adjacent cell is revealed. Click cycles none→door→none
  // (and converts an existing plain wall into a door).
  const toggleDoor = (cx: number, cy: number) => {
    if (!map) return;
    const w = toWorld(cx, cy); if (!w) return;
    const edge = nearestEdge(w.wx, w.wy);
    const walls = map.walls ?? [];
    const existing = walls.find((wl) => wallEdge(wl.points[0], wl.points[1]) === edge.key);
    if (existing && existing.door) saveMap({ walls: walls.filter((wl) => wl.id !== existing.id) });
    else if (existing) saveMap({ walls: walls.map((wl) => (wl.id === existing.id ? { ...wl, door: true } : wl)) });
    else saveMap({ walls: [...walls, { id: uid(), points: edge.points, blocksMovement: false, blocksLight: false, blocksLineOfSight: true, blocksEffect: false, door: true }] });
  };

  const playerView = !isGm || viewAsPlayer;
  const fogActive = isGm && fogTool !== "off";
  const onFogPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (fogTool === "reveal" || fogTool === "hide") {
      const c = pointToCell(e.clientX, e.clientY);
      if (c) { boxStartRef.current = c; setBoxRect({ x0: c.gx, y0: c.gy, x1: c.gx, y1: c.gy }); }
    } else if (fogTool === "room") {
      const c = pointToCell(e.clientX, e.clientY); if (c) floodRoom(c.gx, c.gy, roomMode);
    } else if (fogTool === "wall") {
      wallStartRef.current = pointToIntersection(e.clientX, e.clientY);
    } else if (fogTool === "door") {
      toggleDoor(e.clientX, e.clientY);
    }
  };
  const onFogPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (boxStartRef.current) { const c = pointToCell(e.clientX, e.clientY); if (c) setBoxRect({ x0: boxStartRef.current.gx, y0: boxStartRef.current.gy, x1: c.gx, y1: c.gy }); }
  };
  const onFogPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    if ((fogTool === "reveal" || fogTool === "hide") && boxStartRef.current) {
      const c = pointToCell(e.clientX, e.clientY);
      if (c) applyBox(boxStartRef.current, c, fogTool);
    } else if (fogTool === "wall" && wallStartRef.current) {
      const end = pointToIntersection(e.clientX, e.clientY); if (end) addWallLine(wallStartRef.current, end);
    }
    boxStartRef.current = null; wallStartRef.current = null; setBoxRect(null);
  };
  const onFogDoubleClick = (e: RPointerEvent<HTMLDivElement>) => { if (fogTool === "wall") removeWallNear(e.clientX, e.clientY); };

  // ---- token drag (live-snap to whole cells) -------------------------------
  const onTokenPointerDown = (e: RPointerEvent<HTMLDivElement>, t: { entityId: Id; gx: number; gy: number }) => {
    e.stopPropagation();
    const ent = entityById.get(t.entityId);
    if (!ent) return;
    setSelected(t.entityId); setSelTpl(null);
    setDrag({ entityId: t.entityId, footprint: sizeOf(ent).footprint, baseGx: t.gx, baseGy: t.gy, startX: e.clientX, startY: e.clientY, startScale: view.scale });
    setDragCell({ gx: t.gx, gy: t.gy });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onTokenPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag || !map) return;
    const dCellX = Math.round((e.clientX - drag.startX) / drag.startScale / map.grid.cellPx);
    const dCellY = Math.round((e.clientY - drag.startY) / drag.startScale / map.grid.cellPx);
    const cols = Math.floor(map.width / map.grid.cellPx), rows = Math.floor(map.height / map.grid.cellPx);
    const gx = clamp(drag.baseGx + dCellX, 0, Math.max(0, cols - drag.footprint));
    const gy = clamp(drag.baseGy + dCellY, 0, Math.max(0, rows - drag.footprint));
    setDragCell({ gx, gy });
    if (moveBlocked.size > 0 && cols * rows <= PATH_LIMIT) {
      const path = findPath(drag.baseGx, drag.baseGy, gx, gy, cols, rows);
      setDragPath(path ? { cells: path, blocked: false } : { cells: [[drag.baseGx, drag.baseGy], [gx, gy]], blocked: true });
    } else {
      setDragPath(null); // no walls (or grid too large) → straight-line, unconstrained
    }
  };
  const onTokenPointerUp = () => {
    if (drag && dragCell && !(dragPath?.blocked)) moveToken(drag.entityId, dragCell.gx, dragCell.gy);
    setDrag(null); setDragCell(null); setDragPath(null);
  };

  // ---- template drag (snap origin to intersections) ------------------------
  const onTplPointerDown = (e: RPointerEvent<HTMLDivElement>, t: AoeTemplate) => {
    e.stopPropagation();
    setSelTpl(t.id); setSelected(null);
    setTplDrag({ id: t.id, baseIX: t.originIX, baseIY: t.originIY, startX: e.clientX, startY: e.clientY, startScale: view.scale });
    setTplOrigin({ ix: t.originIX, iy: t.originIY });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onTplPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!tplDrag || !map) return;
    const dx = Math.round((e.clientX - tplDrag.startX) / tplDrag.startScale / map.grid.cellPx);
    const dy = Math.round((e.clientY - tplDrag.startY) / tplDrag.startScale / map.grid.cellPx);
    setTplOrigin({ ix: tplDrag.baseIX + dx, iy: tplDrag.baseIY + dy });
  };
  const onTplPointerUp = () => {
    if (tplDrag && tplOrigin) updateTpl(tplDrag.id, { originIX: tplOrigin.ix, originIY: tplOrigin.iy });
    setTplDrag(null); setTplOrigin(null);
  };

  // ---- light drag (snap to cell) -------------------------------------------
  const onLightPointerDown = (e: RPointerEvent<HTMLDivElement>, L: LightSource) => {
    e.stopPropagation();
    setSelLight(L.id); setSelected(null); setSelTpl(null);
    setLightDrag({ id: L.id, baseGx: L.gx, baseGy: L.gy, startX: e.clientX, startY: e.clientY, startScale: view.scale });
    setLightPos({ gx: L.gx, gy: L.gy });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onLightPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!lightDrag || !map) return;
    const dx = Math.round((e.clientX - lightDrag.startX) / lightDrag.startScale / map.grid.cellPx);
    const dy = Math.round((e.clientY - lightDrag.startY) / lightDrag.startScale / map.grid.cellPx);
    const cols = Math.floor(map.width / map.grid.cellPx), rows = Math.floor(map.height / map.grid.cellPx);
    setLightPos({ gx: clamp(lightDrag.baseGx + dx, 0, cols - 1), gy: clamp(lightDrag.baseGy + dy, 0, rows - 1) });
  };
  const onLightPointerUp = () => {
    if (lightDrag && lightPos) updateLight(lightDrag.id, { gx: lightPos.gx, gy: lightPos.gy });
    setLightDrag(null); setLightPos(null);
  };

  const dragDistanceLabel = useMemo(() => {
    if (!drag || !dragCell || !map) return null;
    if (dragPath?.blocked) return "✕ blocked by a wall";
    const ft = dragPath
      ? pathDistanceFt(dragPath.cells, map.grid.cellFt)
      : ruleset.measureDistanceFt({ x: drag.baseGx, y: drag.baseGy }, { x: dragCell.gx, y: dragCell.gy });
    return formatDistance(ft, { unit });
  }, [drag, dragCell, dragPath, map, ruleset, unit]);

  // ---- lighting (sources, viewer perspective, wall-occluded illumination) --
  const lightSources = useMemo(() => {
    if (!map) return [];
    const arr: Array<{ gx: number; gy: number; shape: "radial" | "cone"; brightFt: number; dir?: number }> = [];
    for (const L of map.lights ?? []) arr.push({ gx: L.gx, gy: L.gy, shape: L.shape, brightFt: L.brightFt, dir: L.dir });
    for (const t of map.tokens) {
      const e = entityById.get(t.entityId);
      const ft = Number(e?.attributes.lightFt) || 0;
      if (e && ft > 0) arr.push({ gx: t.gx, gy: t.gy, shape: e.attributes.lightCone ? "cone" : "radial", brightFt: ft, dir: Number(e.attributes.lightDir) || 0 });
    }
    return arr;
  }, [map, entityById]);
  // The selected token's perspective (low-light doubling / darkvision), else standard.
  const viewer = useMemo(() => {
    if (!selected || !map) return null;
    const e = entityById.get(selected);
    const t = map.tokens.find((tt) => tt.entityId === selected);
    if (!e || !t) return null;
    const lowLight = !!e.attributes.lowLight;
    const darkvisionFt = Number(e.attributes.darkvisionFt) || 0;
    if (!lowLight && !darkvisionFt) return null;
    return { gx: t.gx, gy: t.gy, lowLight, darkvisionFt };
  }, [selected, entityById, map]);
  const lightWalls = useMemo(
    () => (map?.walls ?? []).filter((w) => w.points.length >= 2).map((w) => [w.points[0], w.points[1]] as [[number, number], [number, number]]),
    [map?.walls]
  );
  const lighting = useMemo(() => {
    if (!showLight || !map) return null;
    const cols = Math.floor(map.width / map.grid.cellPx), rows = Math.floor(map.height / map.grid.cellPx);
    if (cols * rows === 0 || cols * rows > 3000) return null; // perf guard
    return computeLighting({ sources: lightSources, viewer, walls: lightWalls, cols, rows, cellFt: map.grid.cellFt });
  }, [showLight, map, lightSources, viewer, lightWalls]);

  // ---- styles --------------------------------------------------------------
  const btn = (color: string, on = false): CSSProperties => ({
    background: on ? "rgba(212,175,55,0.18)" : C.row, border: `1px solid ${on ? C.gold : C.border}`,
    color: on ? C.gold : color, borderRadius: 6, padding: "5px 9px", fontSize: 12, fontWeight: 700, cursor: "pointer",
  });
  const label: CSSProperties = { color: C.dim, fontSize: 11, fontWeight: 700 };

  if (!map) return <div style={{ marginTop: 16, color: C.dim, fontSize: 13 }}>Loading map…</div>;

  const g = map.grid;
  const canAoe = !!ruleset.aoeCells;
  const gridLayer: CSSProperties =
    g.kind === "gridless" ? {} : {
      backgroundImage: `linear-gradient(${g.color} 1px, transparent 1px), linear-gradient(90deg, ${g.color} 1px, transparent 1px)`,
      backgroundSize: `${g.cellPx}px ${g.cellPx}px, ${g.cellPx}px ${g.cellPx}px`,
      backgroundPosition: `${g.offsetX}px ${g.offsetY}px, ${g.offsetX}px ${g.offsetY}px`,
    };
  const unplaced = entities.filter((e) => !map.tokens.some((t) => t.entityId === e.id));
  const selectedTpl = map.aoeTemplates.find((t) => t.id === selTpl) ?? null;
  const selectedLight = (map.lights ?? []).find((L) => L.id === selLight) ?? null;
  const selEntity = selected ? entityById.get(selected) ?? null : null;

  return (
    <div style={{ marginTop: 16, maxWidth: 980 }}>
      {/* toolbar: map + grid */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px" }}>
        <label style={btn(C.text)}>
          Upload map
          <input type="file" accept="image/*" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) loadImageFile(f); e.target.value = ""; }} />
        </label>
        <span style={label}>Cell</span>
        <input type="range" min={16} max={200} value={g.cellPx} onChange={(e) => setGrid({ cellPx: Number(e.target.value) })} />
        <span style={{ ...label, width: 36 }}>{g.cellPx}px</span>
        <span style={label}>Color</span>
        <input type="color" value={toHex(g.color)} onChange={(e) => setGrid({ color: e.target.value })} style={{ width: 30, height: 24, padding: 0, border: `1px solid ${C.border}`, background: "transparent" }} />
        <span style={label}>Off X</span>
        <input type="range" min={0} max={g.cellPx} value={g.offsetX} onChange={(e) => setGrid({ offsetX: Number(e.target.value) })} />
        <span style={label}>Y</span>
        <input type="range" min={0} max={g.cellPx} value={g.offsetY} onChange={(e) => setGrid({ offsetY: Number(e.target.value) })} />
        <div style={{ flex: 1 }} />
        <span style={label}>Units</span>
        <button style={btn(C.text)} title="Switch distance units (shared by the campaign)" onClick={() => saveUnit(unit === "ft" ? "m" : "ft")}>{unit}</button>
        <button style={btn(C.text)} onClick={() => setView((v) => ({ ...v, scale: clamp(v.scale / 1.1, 0.2, 6) }))}>−</button>
        <button style={btn(C.gold)} onClick={fit}>Fit</button>
        <button style={btn(C.text)} onClick={() => setView((v) => ({ ...v, scale: clamp(v.scale * 1.1, 0.2, 6) }))}>+</button>
      </div>

      {/* toolbar: overlays + tokens */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <button style={btn(C.text, showReach)} onClick={() => setShowReach((s) => !s)}>Reach {showReach ? "on" : "off"}</button>
        {isGm && <>
          <span style={{ ...label, marginLeft: 6 }}>Fog:</span>
          <button style={btn(C.text, fog.enabled)} onClick={() => setFog({ enabled: !fog.enabled })}>{fog.enabled ? "On" : "Off"}</button>
          <button style={btn(C.text, fogTool === "reveal")} onClick={() => setFogTool((t) => (t === "reveal" ? "off" : "reveal"))} title="Drag a box to reveal everything inside">Reveal</button>
          <button style={btn(C.text, fogTool === "hide")} onClick={() => setFogTool((t) => (t === "hide" ? "off" : "hide"))} title="Drag a box to hide everything inside">Hide</button>
          <button
            style={btn(C.text, fogTool === "room")}
            onClick={() => {
              if (fogTool !== "room") { setFogTool("room"); setRoomMode("reveal"); }
              else if (roomMode === "reveal") setRoomMode("hide");
              else setFogTool("off");
            }}
            title="Click inside a room to reveal/hide it (stops at walls & doors). Click to switch reveal/hide."
          >
            {fogTool === "room" ? `Room: ${roomMode}` : "Room"}
          </button>
          <button style={btn(C.text, fogTool === "wall")} onClick={() => setFogTool((t) => (t === "wall" ? "off" : "wall"))} title="Drag along grid lines to add walls; double-click a wall to remove">Wall</button>
          <button style={btn(C.text, fogTool === "door")} onClick={() => setFogTool((t) => (t === "door" ? "off" : "door"))} title="Click an edge to add a door (or remove one). Doors block sight but appear to players from a revealed side.">Door</button>
          <button style={btn(C.dim)} onClick={revealAll}>Reveal all</button>
          <button style={btn(C.dim)} onClick={hideAll}>Hide all</button>
          <button style={btn(C.gold, viewAsPlayer)} onClick={() => setViewAsPlayer((v) => !v)} title="Preview exactly what players see">{viewAsPlayer ? "Player view" : "View as player"}</button>
        </>}
        {canAoe && <>
          <span style={{ ...label, marginLeft: 6 }}>AoE:</span>
          <button style={btn(C.gold)} onClick={() => addTemplate("burst")}>+ Burst</button>
          <button style={btn(C.gold)} onClick={() => addTemplate("cone")}>+ Cone</button>
          <button style={btn(C.gold)} onClick={() => addTemplate("line")}>+ Line</button>
        </>}
        {isGm && <>
          <span style={{ ...label, marginLeft: 6 }}>Light:</span>
          <button style={btn(C.text, showLight)} onClick={() => setShowLight((s) => !s)} title="Show wall-occluded illumination. Select a token to view from its perspective (low-light / darkvision).">{showLight ? "On" : "Off"}</button>
          {showLight && <button style={btn(C.gold)} onClick={addLight} title="Place an independent light source">+ Light</button>}
        </>}
        {unplaced.length > 0 && <>
          <span style={{ ...label, marginLeft: 6 }}>Place:</span>
          {unplaced.map((e) => (
            <button key={e.id} style={btn(e.color || (e.kind === "pc" ? C.pc : C.npc))} onClick={() => placeToken(e.id)}>+ {e.name}</button>
          ))}
        </>}
      </div>

      {/* viewport */}
      <div
        ref={viewportRef}
        onWheel={onWheel}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) loadImageFile(f); }}
        style={{ position: "relative", height: 540, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", background: C.bg, touchAction: "none" }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, width: map.width, height: map.height, transformOrigin: "0 0", transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}>
          {bgSrc
            ? <img src={bgSrc} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", userSelect: "none" }} />
            : <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(45deg,#0d1017,#0d1017 12px,#0f131c 12px,#0f131c 24px)" }} />}

          <div style={{ position: "absolute", inset: 0, ...gridLayer }} />

          {/* reach overlay */}
          {showReach && !playerView && map.tokens.map((t) => {
            const e = entityById.get(t.entityId);
            if (!e) return null;
            const sid = e.sizeId ?? "medium";
            const reachWeapon = !!e.attributes.reachWeapon;
            let cells = ruleset.reachCells(sid);
            if (reachWeapon) {
              // Reach weapon: threaten only the ring beyond normal reach up to
              // double reach — strikes at range but not adjacent foes.
              const extended = ruleset.reachCells(sid, sizeOf(e).reachFt * 2);
              const near = new Set(cells.map((c) => `${c.x},${c.y}`));
              cells = extended.filter((c) => !near.has(`${c.x},${c.y}`));
            }
            if (!cells.length) return null;
            const pos = drag?.entityId === t.entityId && dragCell ? dragCell : t;
            const accent = e.color || (e.kind === "pc" ? C.pc : C.npc);
            const fillA = reachWeapon ? 0.1 : 0.16;
            return cells.map((c) => (
              <div key={`reach-${t.entityId}-${c.x}-${c.y}`} style={{ position: "absolute", left: g.offsetX + (pos.gx + c.x) * g.cellPx, top: g.offsetY + (pos.gy + c.y) * g.cellPx, width: g.cellPx, height: g.cellPx, background: hexToRgba(accent, fillA), border: `1px ${reachWeapon ? "dashed" : "solid"} ${hexToRgba(accent, 0.32)}`, pointerEvents: "none", zIndex: 6 }} />
            ));
          })}

          {/* AoE templates */}
          {map.aoeTemplates.map((t) => {
            const cells = ruleset.aoeCells?.({ shape: t.shape, sizeFt: t.sizeFt, dir: t.dir, angleDeg: t.angleDeg, cellFt: g.cellFt }) ?? [];
            const o = tplDrag?.id === t.id && tplOrigin ? tplOrigin : { ix: t.originIX, iy: t.originIY };
            const sel = selTpl === t.id;
            const effImg = t.effect?.kind === "custom" && t.effect.assetId ? assetById.get(t.effect.assetId)?.storageRef ?? null : null;
            const fill = effImg ? "transparent" : t.effect?.kind ? effectFill(t.effect.kind, t.opacity) : hexToRgba(t.color, t.opacity);
            const edge = hexToRgba(t.color, Math.min(1, t.opacity + 0.35));
            const oxPx = g.offsetX + o.ix * g.cellPx, oyPx = g.offsetY + o.iy * g.cellPx;
            let minA = 0, minB = 0, maxA = 0, maxB = 0;
            cells.forEach((c) => { minA = Math.min(minA, c.x); minB = Math.min(minB, c.y); maxA = Math.max(maxA, c.x + 1); maxB = Math.max(maxB, c.y + 1); });
            const dotR = clamp(g.cellPx * 0.16, 4, 12);
            return (
              <div key={t.id}>
                {cells.map((c) => (
                  <div key={`${t.id}-${c.x}-${c.y}`}
                    onPointerDown={(e) => onTplPointerDown(e, t)} onPointerMove={onTplPointerMove} onPointerUp={onTplPointerUp}
                    onDoubleClick={(e) => { e.stopPropagation(); removeTpl(t.id); }}
                    style={{ position: "absolute", left: g.offsetX + (o.ix + c.x) * g.cellPx, top: g.offsetY + (o.iy + c.y) * g.cellPx, width: g.cellPx, height: g.cellPx, background: fill, border: `1px solid ${edge}`, overflow: "hidden", cursor: "grab", touchAction: "none", zIndex: sel ? 16 : 10 }}>
                    {effImg && <img src={effImg} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: t.opacity, pointerEvents: "none" }} />}
                  </div>
                ))}
                {sel && cells.length > 0 && (
                  <div style={{ position: "absolute", left: g.offsetX + (o.ix + minA) * g.cellPx, top: g.offsetY + (o.iy + minB) * g.cellPx, width: (maxA - minA) * g.cellPx, height: (maxB - minB) * g.cellPx, border: "2px dashed rgba(255,255,255,0.85)", pointerEvents: "none", zIndex: 17 }} />
                )}
                <div onPointerDown={(e) => onTplPointerDown(e, t)} onPointerMove={onTplPointerMove} onPointerUp={onTplPointerUp} title="Spell origin — drag to move"
                  style={{ position: "absolute", left: oxPx - dotR, top: oyPx - dotR, width: 2 * dotR, height: 2 * dotR, borderRadius: "50%", background: t.color, border: "1.5px solid #fff", cursor: "grab", touchAction: "none", zIndex: sel ? 19 : 12 }} />
              </div>
            );
          })}

          {/* token drag target highlight */}
          {drag && dragCell && (
            <div style={{ position: "absolute", left: g.offsetX + dragCell.gx * g.cellPx, top: g.offsetY + dragCell.gy * g.cellPx, width: drag.footprint * g.cellPx, height: drag.footprint * g.cellPx, border: `2px dashed ${C.gold}`, background: "rgba(212,175,55,0.12)", borderRadius: 4, pointerEvents: "none", zIndex: 18 }} />
          )}

          {/* movement path trace (around walls; red if blocked) */}
          {drag && dragPath && (() => {
            const col = dragPath.blocked ? C.danger : C.gold;
            const cx = (x: number) => g.offsetX + (x + 0.5) * g.cellPx, cy = (y: number) => g.offsetY + (y + 0.5) * g.cellPx;
            const pts = dragPath.cells.map(([x, y]) => `${cx(x)},${cy(y)}`).join(" ");
            const r = Math.max(2, g.cellPx * 0.09);
            return (
              <svg width={map.width} height={map.height} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 19 }}>
                <polyline points={pts} fill="none" stroke={col} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dragPath.blocked ? "9 6" : undefined} opacity={0.95} />
                {dragPath.cells.map(([x, y], i) => <circle key={i} cx={cx(x)} cy={cy(y)} r={r} fill={col} />)}
              </svg>
            );
          })()}

          {/* tokens (with same-cell stacking, condition icons and damage) */}
          {(() => {
            const placed = map.tokens
              .map((t) => {
                const e = entityById.get(t.entityId);
                if (!e) return null;
                const sd = sizeOf(e);
                const pos = drag?.entityId === t.entityId && dragCell ? dragCell : t;
                return { t, e, sd, gx: pos.gx, gy: pos.gy };
              })
              .filter((x): x is NonNullable<typeof x> => x !== null);

            const placements = computePlacements(
              placed.map((p) => ({ entityId: p.t.entityId, gx: p.gx, gy: p.gy, footprint: p.sd.footprint, spaceFt: p.sd.spaceFt, scale: p.sd.scale })),
              g.cellPx
            );

            return placed.map(({ t, e, sd, gx, gy }) => {
              // In player view, don't draw tokens sitting entirely in unrevealed cells.
              if (playerView && fog.enabled) {
                let anyVisible = false;
                for (let dx = 0; dx < sd.footprint && !anyVisible; dx++)
                  for (let dy = 0; dy < sd.footprint && !anyVisible; dy++)
                    if (isRevealed(gx + dx, gy + dy)) anyVisible = true;
                if (!anyVisible) return null;
              }
              const box = sd.footprint * g.cellPx, dia = box * sd.scale;
              const accent = e.color || (e.kind === "pc" ? C.pc : C.npc);
              const isSel = selected === t.entityId;
              const isActive = activeId === t.entityId;
              const portrait = e.portraitAssetId ? assetById.get(e.portraitAssetId)?.storageRef ?? null : null;
              const pl = placements.get(t.entityId) ?? { dx: 0, dy: 0, z: 20 };
              const z = isActive ? 100 : isSel ? 90 : pl.z;
              const ring = isActive
                ? `0 0 0 3px ${C.gold}, 0 0 12px rgba(212,175,55,0.85)`
                : isSel ? `0 0 0 2px rgba(255,255,255,0.55)` : "0 1px 3px rgba(0,0,0,0.6)";
              const damage = Number(e.attributes.damage) || 0;
              const conds = e.conditions
                .map((id) => ruleset.conditions.find((c) => c.id === id))
                .filter((c): c is NonNullable<typeof c> => !!c);
              const shown = conds.slice(0, 6);
              const extra = conds.length - shown.length;
              const down = conds.some((c) => c.defeated); // dead / unconscious
              const badge = Math.max(10, Math.min(15, g.cellPx * 0.26));

              return (
                <div key={t.entityId}
                  onPointerDown={(ev) => onTokenPointerDown(ev, t)} onPointerMove={onTokenPointerMove} onPointerUp={onTokenPointerUp}
                  onDoubleClick={(ev) => { ev.stopPropagation(); removeToken(t.entityId); }}
                  title={`${e.name}${conds.length ? " — " + conds.map((c) => c.label).join(", ") : ""}`}
                  style={{ position: "absolute", left: g.offsetX + gx * g.cellPx, top: g.offsetY + gy * g.cellPx, width: box, height: box, transform: `translate(${pl.dx}px, ${pl.dy}px)`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "grab", zIndex: down && !isActive && !isSel ? 4 : z }}>
                  <div style={{ width: dia, height: dia, borderRadius: "50%", overflow: "hidden", background: portrait ? "#0a0c11" : `${accent}cc`, border: `2px solid ${isActive ? C.gold : "#0a0c11"}`, boxShadow: ring, filter: down ? "grayscale(100%)" : undefined, opacity: down ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#0a0c11", fontWeight: 800, fontSize: Math.max(9, Math.min(16, dia * 0.4)) }}>
                    {portrait
                      ? <img src={portrait} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", userSelect: "none" }} />
                      : initials(e.name)}
                  </div>

                  {/* damage badge */}
                  {damage > 0 && (
                    <span style={{ position: "absolute", top: -4, right: -4, minWidth: badge, height: badge, padding: "0 3px", boxSizing: "border-box", borderRadius: badge, background: C.danger, color: "#fff", fontWeight: 800, fontSize: badge * 0.62, lineHeight: `${badge}px`, textAlign: "center", border: "1px solid #0a0c11" }}>
                      {damage}
                    </span>
                  )}

                  {/* condition icons */}
                  {shown.length > 0 && (
                    <div style={{ position: "absolute", top: -badge - 2, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 1, whiteSpace: "nowrap", background: "rgba(10,12,17,0.7)", borderRadius: badge, padding: "1px 3px" }}>
                      {shown.map((c) => (
                        <span key={c.id} title={c.label} style={{ fontSize: badge * 0.8, lineHeight: `${badge}px` }}>{c.icon ?? "•"}</span>
                      ))}
                      {extra > 0 && <span style={{ fontSize: badge * 0.6, color: C.text, lineHeight: `${badge}px`, fontWeight: 800 }}>+{extra}</span>}
                    </div>
                  )}

                  {sd.scale >= 1 && (
                    <span style={{ position: "absolute", top: box - 2, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap", fontSize: 10, fontWeight: 700, color: C.text, background: "rgba(10,12,17,0.75)", padding: "0 4px", borderRadius: 3 }}>{e.name}</span>
                  )}
                </div>
              );
            });
          })()}

          {/* lighting overlay (dim/dark cells), below tokens so they stay visible */}
          {showLight && lighting && (() => {
            const cols = Math.floor(map.width / map.grid.cellPx), rows = Math.floor(map.height / map.grid.cellPx);
            const rects: JSX.Element[] = [];
            for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
              const lvl = lighting.get(`${x},${y}`) ?? 0;
              if (lvl === 2) continue;
              rects.push(<rect key={`lit-${x}-${y}`} x={g.offsetX + x * g.cellPx} y={g.offsetY + y * g.cellPx} width={g.cellPx} height={g.cellPx} fill="#03040a" opacity={lvl === 1 ? 0.34 : 0.62} />);
            }
            return <svg width={map.width} height={map.height} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 8 }}>{rects}</svg>;
          })()}

          {/* independent light markers (GM, when lighting is on) */}
          {isGm && showLight && (map.lights ?? []).map((L) => {
            const pos = lightDrag?.id === L.id && lightPos ? lightPos : { gx: L.gx, gy: L.gy };
            const cxp = g.offsetX + (pos.gx + 0.5) * g.cellPx, cyp = g.offsetY + (pos.gy + 0.5) * g.cellPx;
            const r = clamp(g.cellPx * 0.2, 6, 15);
            const sel = selLight === L.id;
            return (
              <div key={L.id}
                onPointerDown={(e) => onLightPointerDown(e, L)} onPointerMove={onLightPointerMove} onPointerUp={onLightPointerUp}
                onDoubleClick={(e) => { e.stopPropagation(); removeLight(L.id); }}
                title="Light source — drag to move, double-click to remove"
                style={{ position: "absolute", left: cxp - r, top: cyp - r, width: 2 * r, height: 2 * r, borderRadius: "50%", background: "radial-gradient(circle, #ffe79a, #f5a623)", border: `2px solid ${sel ? "#fff" : "#7a5a10"}`, boxShadow: "0 0 12px rgba(245,166,35,0.95)", cursor: "grab", touchAction: "none", zIndex: sel ? 21 : 13 }} />
            );
          })}

          {/* fog of war + walls + doors overlay (SVG) */}
          {(fog.enabled || (map.walls?.length ?? 0) > 0) && (() => {
            const { cols, rows } = gridDims();
            const hidden: Array<[number, number]> = [];
            if (fog.enabled) {
              for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!isRevealed(x, y)) hidden.push([x, y]);
            }
            const fogA = playerView ? 1 : 0.45;
            const all = map.walls ?? [];
            const walls = all.filter((w) => !w.door);
            const doors = all.filter((w) => w.door);
            const doorVisibleToPlayer = (w: Wall) => {
              const [[ax, ay], [bx, by]] = [w.points[0], w.points[1]];
              const adj: Array<[number, number]> = ay === by
                ? [[Math.min(ax, bx), ay - 1], [Math.min(ax, bx), ay]]
                : [[ax - 1, Math.min(ay, by)], [ax, Math.min(ay, by)]];
              return adj.some(([x, y]) => isRevealed(x, y));
            };
            return (
              <svg width={map.width} height={map.height} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 18 }}>
                {fog.enabled && hidden.map(([x, y]) => (
                  <rect key={`fog-${x}-${y}`} x={g.offsetX + x * g.cellPx} y={g.offsetY + y * g.cellPx} width={g.cellPx} height={g.cellPx} fill="#05070b" opacity={fogA} />
                ))}
                {!playerView && walls.map((w) => {
                  const [[ax, ay], [bx, by]] = [w.points[0], w.points[1]];
                  return <line key={w.id} x1={g.offsetX + ax * g.cellPx} y1={g.offsetY + ay * g.cellPx} x2={g.offsetX + bx * g.cellPx} y2={g.offsetY + by * g.cellPx} stroke="#e8b54a" strokeWidth={4} strokeLinecap="round" opacity={0.95} />;
                })}
                {doors.map((w) => {
                  if (playerView && !doorVisibleToPlayer(w)) return null;
                  const [[ax, ay], [bx, by]] = [w.points[0], w.points[1]];
                  const horizontal = ay === by;
                  const mx = g.offsetX + ((ax + bx) / 2) * g.cellPx;
                  const my = g.offsetY + ((ay + by) / 2) * g.cellPx;
                  const long = g.cellPx * 0.6, thick = Math.max(4, g.cellPx * 0.18);
                  const w_ = horizontal ? long : thick, h_ = horizontal ? thick : long;
                  return <rect key={w.id} x={mx - w_ / 2} y={my - h_ / 2} width={w_} height={h_} rx={2} fill="#b9824f" stroke="#f0dcae" strokeWidth={1.5} />;
                })}
                {boxRect && (() => {
                  const x0 = Math.min(boxRect.x0, boxRect.x1), x1 = Math.max(boxRect.x0, boxRect.x1);
                  const y0 = Math.min(boxRect.y0, boxRect.y1), y1 = Math.max(boxRect.y0, boxRect.y1);
                  const stroke = fogTool === "hide" ? C.danger : C.gold;
                  return <rect x={g.offsetX + x0 * g.cellPx} y={g.offsetY + y0 * g.cellPx} width={(x1 - x0 + 1) * g.cellPx} height={(y1 - y0 + 1) * g.cellPx} fill={hexToRgba(stroke, 0.18)} stroke={stroke} strokeWidth={2} strokeDasharray="6 4" />;
                })()}
              </svg>
            );
          })()}

          {/* fog/wall paint interaction layer (GM, only while a tool is active) */}
          {fogActive && (
            <div
              onPointerDown={onFogPointerDown}
              onPointerMove={onFogPointerMove}
              onPointerUp={onFogPointerUp}
              onPointerCancel={onFogPointerUp}
              onDoubleClick={onFogDoubleClick}
              style={{ position: "absolute", left: 0, top: 0, width: map.width, height: map.height, zIndex: 60, cursor: "crosshair", touchAction: "none" }}
            />
          )}
        </div>

        {/* drag distance readout */}
        {dragDistanceLabel && (
          <div style={{ position: "absolute", left: 10, bottom: 10, background: "rgba(10,12,17,0.85)", border: `1px solid ${C.border}`, color: C.gold, fontWeight: 800, fontSize: 13, padding: "4px 8px", borderRadius: 6, pointerEvents: "none" }}>{dragDistanceLabel}</div>
        )}

        {/* AoE editor */}
        {selectedTpl && (
          <div onPointerDown={(e) => e.stopPropagation()}
            style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 55, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 9, padding: "8px 10px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", flexWrap: "wrap", maxWidth: "92%" }}>
            <span style={{ color: C.gold, fontWeight: 800, fontSize: 12, textTransform: "capitalize" }}>{selectedTpl.shape}</span>
            <span style={label}>Size</span>
            <input type="range" min={5} max={60} step={5} value={selectedTpl.sizeFt} onChange={(e) => updateTpl(selectedTpl.id, { sizeFt: Number(e.target.value) })} />
            <span style={{ ...label, width: 44 }}>{formatDistance(selectedTpl.sizeFt, { unit })}</span>
            <span style={label}>Effect</span>
            <select
              value={selectedTpl.effect?.kind === "custom" ? "custom" : selectedTpl.effect?.kind ?? "none"}
              onChange={(e) => { const v = e.target.value; if (v === "custom") return; setTplEffect(selectedTpl, v === "none" ? undefined : { kind: v as Exclude<EffectKind, "custom"> }); }}
              style={{ background: C.row, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 6px", fontSize: 12 }}
            >
              <option value="none">None (tint)</option>
              {EFFECT_PRESETS.map((p) => <option key={p.kind} value={p.kind}>{p.label}</option>)}
              {selectedTpl.effect?.kind === "custom" && <option value="custom">Custom image</option>}
            </select>
            <label style={btn(C.text)} title="Upload an image to tile over the affected cells (semi-transparent)">
              Img
              <input type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadEffectImage(selectedTpl, f); e.target.value = ""; }} />
            </label>
            <span style={label}>Opacity</span>
            <input type="range" min={0.1} max={0.6} step={0.02} value={selectedTpl.opacity} onChange={(e) => updateTpl(selectedTpl.id, { opacity: Number(e.target.value) })} />
            <input type="color" value={toHex(selectedTpl.color)} onChange={(e) => updateTpl(selectedTpl.id, { color: e.target.value })} style={{ width: 30, height: 24, padding: 0, border: `1px solid ${C.border}`, background: "transparent" }} />
            {selectedTpl.shape !== "burst" && (() => {
              const curDeg = Math.round(selectedTpl.angleDeg ?? DIR_ANGLE[selectedTpl.dir ?? "E"]);
              return (
                <>
                  <span style={label}>Aim</span>
                  <input type="range" min={0} max={355} step={5} value={curDeg} onChange={(e) => updateTpl(selectedTpl.id, { angleDeg: Number(e.target.value) })} />
                  <span style={{ ...label, width: 34 }}>{curDeg}°</span>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 22px)", gridTemplateRows: "repeat(3, 22px)", gap: 2 }}>
                    {COMPASS.map((d, i) => d === null
                      ? <div key={i} />
                      : <button key={i} title={`${d} (${DIR_ANGLE[d]}°)`} onClick={() => updateTpl(selectedTpl.id, { angleDeg: DIR_ANGLE[d], dir: d })}
                          style={{ background: curDeg === DIR_ANGLE[d] ? C.gold : C.row, color: curDeg === DIR_ANGLE[d] ? "#0a0c11" : C.text, border: `1px solid ${C.border}`, borderRadius: 4, cursor: "pointer", fontWeight: 800, fontSize: 12, padding: 0 }}>{DIR_ARROW[d]}</button>)}
                  </div>
                </>
              );
            })()}
            <button style={{ ...btn("#fff"), background: "#d9544a", border: "1px solid #d9544a" }} onClick={() => removeTpl(selectedTpl.id)}>Delete</button>
          </div>
        )}

        {/* light-source editor */}
        {isGm && showLight && selectedLight && (
          <div onPointerDown={(e) => e.stopPropagation()}
            style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 55, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 9, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", flexWrap: "wrap", maxWidth: "92%" }}>
            <span style={{ color: "#f5a623", fontWeight: 800, fontSize: 12 }}>Light</span>
            {([5, 15, 20, 30] as const).map((ft) => (
              <button key={ft} style={btn(C.text, selectedLight.shape === "radial" && selectedLight.brightFt === ft)} onClick={() => updateLight(selectedLight.id, { shape: "radial", brightFt: ft })}>{formatDistance(ft, { unit })}</button>
            ))}
            <button style={btn(C.text, selectedLight.shape === "cone")} onClick={() => updateLight(selectedLight.id, { shape: "cone", brightFt: 60 })} title="60 ft cone">Cone</button>
            {selectedLight.shape === "cone" && (
              <>
                <span style={label}>Aim</span>
                <input type="range" min={0} max={355} step={5} value={Math.round(selectedLight.dir ?? 0)} onChange={(e) => updateLight(selectedLight.id, { dir: Number(e.target.value) })} />
                <span style={{ ...label, width: 34 }}>{Math.round(selectedLight.dir ?? 0)}°</span>
              </>
            )}
            <button style={{ ...btn("#fff"), background: "#d9544a", border: "1px solid #d9544a" }} onClick={() => removeLight(selectedLight.id)}>Delete</button>
          </div>
        )}

        {/* token light & vision editor */}
        {isGm && showLight && selEntity && (() => {
          const lf = Number(selEntity.attributes.lightFt) || 0;
          const dv = Number(selEntity.attributes.darkvisionFt) || 0;
          return (
            <div onPointerDown={(e) => e.stopPropagation()}
              style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 55, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 9, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", flexWrap: "wrap", maxWidth: "94%" }}>
              <span style={{ color: C.gold, fontWeight: 800, fontSize: 12, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selEntity.name}</span>
              <span style={label}>Light</span>
              {([0, 5, 15, 20, 30] as const).map((ft) => (
                <button key={ft} style={btn(C.text, lf === ft)} onClick={() => setEntityAttr(selEntity, { lightFt: ft })}>{ft ? formatDistance(ft, { unit }) : "None"}</button>
              ))}
              <button style={btn(C.text, !!selEntity.attributes.lightCone)} onClick={() => setEntityAttr(selEntity, { lightCone: !selEntity.attributes.lightCone })} title="Emit a cone instead of a radius">Cone</button>
              {!!selEntity.attributes.lightCone && (
                <>
                  <span style={label}>Aim</span>
                  <input type="range" min={0} max={355} step={5} value={Number(selEntity.attributes.lightDir) || 0} onChange={(e) => setEntityAttr(selEntity, { lightDir: Number(e.target.value) })} />
                </>
              )}
              <span style={{ ...label, marginLeft: 6 }}>Vision</span>
              <button style={btn(C.text, !!selEntity.attributes.lowLight)} onClick={() => setEntityAttr(selEntity, { lowLight: !selEntity.attributes.lowLight })} title="Doubles the bright & shadowy range of every light (from this token's view)">Low-light</button>
              <button style={btn(C.text, dv > 0)} onClick={() => setEntityAttr(selEntity, { darkvisionFt: dv > 0 ? 0 : 60 })} title="Sees its own radius as bright, even in darkness">Darkvision 60</button>
            </div>
          );
        })()}
      </div>

      <p style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>
        Drag canvas to pan, scroll to zoom, drag tokens to move (snaps to grid; distance bottom-left). Double-click a token or AoE to remove it.
        Add an area template, then drag its origin dot (snaps to grid intersections) and tune it in the floating editor. Reach + AoE geometry come from the <strong>{ruleset.meta.name}</strong> ruleset.
      </p>
    </div>
  );
}

/** Accept a hex or rgba() grid color; return a hex for <input type=color>. */
function toHex(color: string): string {
  if (color.startsWith("#")) return color.slice(0, 7);
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return "#d4af37";
  const [r, gg, b] = m[1].split(",").map((s) => parseInt(s.trim(), 10));
  const h = (n: number) => clamp(n || 0, 0, 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(gg)}${h(b)}`;
}
