// src/core/domain/map.ts
import type { BaseRecord, Id } from "./domain";

/** Grid model chosen per ruleset: square grid, hex grid, or no grid (narrative). */
export type GridKind = "square" | "hex" | "gridless";

export interface GridConfig {
  kind: GridKind;
  cellPx: number;
  cellFt: number;
  offsetX: number;
  offsetY: number;
  color: string;
}

export interface TokenPlacement {
  entityId: Id;
  gx: number;
  gy: number;
}

export interface AoeTemplate {
  id: Id;
  shape: "burst" | "cone" | "line";
  originIX: number;
  originIY: number;
  sizeFt: number;
  dir?: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW"; // 8-way preset (label/quick-aim)
  angleDeg?: number; // free aim: degrees clockwise from east (screen +x). Overrides dir.
  color: string;
  opacity: number;
  effect?: {
    // spell/terrain visuals — cosmetic only
    kind: "fire" | "ice" | "mud" | "fog" | "water" | "acid" | "custom";
    assetId?: Id;
    animated?: boolean;
  };
}

export interface Wall {
  // drives fog of war, light, and (later) spell-range limits
  id: Id;
  points: Array<[number, number]>;
  blocksMovement: boolean;
  blocksLight: boolean;
  blocksLineOfSight: boolean;
  blocksEffect: boolean;
  door?: boolean; // a door: blocks like a wall but is shown to players from a revealed side
  open?: boolean; // door state: open doors pass movement, light and sight
  secret?: boolean; // GM-only door: looks like a wall to players until opened
  label?: string; // short non-sequential code shown on doors so the GM can identify them
}

export interface LightSource {
  id: Id;
  gx: number;
  gy: number;
  shape: "radial" | "cone";
  brightFt: number; // clear radius; shadowy extends to 2x this
  dir?: number; // degrees clockwise from +x (cone only)
  color?: string;
}

export interface FogState {
  enabled: boolean;
  revealed: Array<[number, number]>;
  los?: boolean; // line-of-sight mode: render only what the party currently sees
}

export interface MapDoc extends BaseRecord {
  collection: "maps";
  name: string;
  backgroundAssetId?: Id;
  width: number;
  height: number;
  grid: GridConfig;
  tokens: TokenPlacement[];
  aoeTemplates: AoeTemplate[];
  walls: Wall[];
  lights?: LightSource[];
  ambient?: "bright" | "dim" | "dark"; // base illumination floor (default "dark")
  fog?: FogState;
}

export interface Asset extends BaseRecord {
  collection: "assets";
  kind: "image";
  mime: string;
  storageRef: string; // data URL (local) or public URL (Supabase Storage)
  storagePath?: string; // object path within the Storage bucket, when cloud-backed
  width?: number;
  height?: number;
  source: "upload" | "ai"; // [future] AI map/wall generation
  prompt?: string;
}
