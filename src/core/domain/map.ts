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
    // [future] spell visuals — cosmetic only
    kind: "fire" | "ice" | "mud" | "fog" | "acid" | "custom";
    assetId?: Id;
    animated?: boolean;
  };
}

export interface Wall {
  // [future] drives fog of war, light, and spell-range limits
  id: Id;
  points: Array<[number, number]>;
  blocksMovement: boolean;
  blocksLight: boolean;
  blocksLineOfSight: boolean;
  blocksEffect: boolean;
}

export interface FogState {
  // [future] player-specific reveal is enforced server-side (RLS)
  enabled: boolean;
  revealed: Array<[number, number]>;
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
  fog?: FogState;
}

export interface Asset extends BaseRecord {
  collection: "assets";
  kind: "image";
  mime: string;
  storageRef: string;
  width?: number;
  height?: number;
  source: "upload" | "ai"; // [future] AI map/wall generation
  prompt?: string;
}
