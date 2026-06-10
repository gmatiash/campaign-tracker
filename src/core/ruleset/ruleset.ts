// src/core/ruleset/ruleset.ts
import type { Entity } from "../domain/domain";
import type { GridKind } from "../domain/map";

export interface RulesetMeta {
  id: string;
  name: string;
  version: string;
}

export interface ConditionDef {
  id: string;
  label: string;
  icon?: string;
  color?: string;
  description?: string;
  /** Creature is out of the fight (dead/unconscious): rendered de-emphasised on the map. */
  defeated?: boolean;
}

export interface SizeDef {
  id: string;
  label: string;
  footprint: number; // grid squares (1 for sub-Small)
  spaceFt: number;
  reachFt: number;
  scale: number; // visual scale inside one square for sub-Small creatures
}

export interface FieldDef {
  key: string;
  label: string;
  type: "number" | "text" | "boolean" | "select";
  options?: string[];
  group?: string;
  default?: unknown;
}

export type CellOffset = { x: number; y: number };

export type AoeShape = "burst" | "cone" | "line";
export type Dir8 = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export interface AoeQuery {
  shape: AoeShape;
  sizeFt: number;
  dir?: Dir8;
  angleDeg?: number; // free aim, degrees clockwise from east (screen +x); overrides dir
  cellFt: number; // grid cell size in feet (from the map's grid)
}

/**
 * The contract every game system implements. Combat and character sheets read
 * all system-specific behavior from the ACTIVE ruleset — never hard-coded.
 */
export interface Ruleset {
  meta: RulesetMeta;
  grid: { kind: GridKind; cellFt: number };

  conditions: ConditionDef[];
  sizes: SizeDef[]; // empty for gridless systems
  characterSchema: FieldDef[];

  createBlankAttributes(): Record<string, unknown>;
  deriveStats?(attrs: Record<string, unknown>): Record<string, number>;
  rollInitiative(entity: Entity): number;

  measureDistanceFt(from: CellOffset, to: CellOffset): number;

  /**
   * Threatened squares for a creature, as offsets from its footprint origin.
   * Pass reachFtOverride to compute at a non-default reach (e.g. a reach weapon).
   */
  reachCells(sizeId: string, reachFtOverride?: number): CellOffset[];

  /**
   * Grid cells an area template covers, as offsets (in cells) from the template's
   * origin intersection. Optional — gridless or differently-templated systems
   * may omit it. The combat/map module renders whatever this returns.
   */
  aoeCells?(q: AoeQuery): CellOffset[];
}

const REGISTRY = new Map<string, Ruleset>();

export function registerRuleset(r: Ruleset): void {
  REGISTRY.set(r.meta.id, r);
}

export function getRuleset(id: string): Ruleset {
  const r = REGISTRY.get(id);
  if (!r) throw new Error(`Unknown ruleset: ${id}`);
  return r;
}
