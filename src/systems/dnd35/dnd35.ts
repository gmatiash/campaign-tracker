// src/systems/dnd35/dnd35.ts
import type { Entity } from "../../core/domain/domain";
import type { AoeQuery, CellOffset, ConditionDef, Ruleset, SizeDef } from "../../core/ruleset/ruleset";
import { registerRuleset } from "../../core/ruleset/ruleset";

/* D&D 3.5e diagonal movement: 1st diagonal 5ft, 2nd 10ft, alternating. */
function diagDistance(dx: number, dy: number): number {
  const diag = Math.min(dx, dy);
  const straight = Math.max(dx, dy) - diag;
  return 5 * Math.ceil(diag / 2) + 10 * Math.floor(diag / 2) + straight * 5;
}

const DIR_ANGLE: Record<string, number> = { E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225, N: 270, NE: 315 };

/*
 * Discrete AoE: a square is covered when >= 50% of its area falls under the ideal
 * shape (burst = disk, cone = 90deg sector, line = 1-square-wide ray), sampled on
 * a 7x7 subgrid. This reproduces the official stepped 1-2-1 diagonal patterns.
 * Returns cell offsets (in squares) from the origin intersection.
 */
function computeAoeCells({ shape, sizeFt, dir, angleDeg, cellFt }: AoeQuery): CellOffset[] {
  const L = (sizeFt || 0) / (cellFt || 5); // radius / length in squares
  if (L <= 0) return [];
  const deg = angleDeg != null ? angleDeg : DIR_ANGLE[dir || "E"] ?? 0;
  const ang = (deg * Math.PI) / 180;
  const f = { x: Math.cos(ang), y: Math.sin(ang) }; // forward unit vector
  const p = { x: -Math.sin(ang), y: Math.cos(ang) }; // perpendicular (+90deg)
  const HALF = Math.PI / 4; // 90deg cone -> +/-45deg

  const inside = (x: number, y: number): boolean => {
    if (shape === "burst") return x * x + y * y <= L * L;
    if (shape === "cone") {
      if (x === 0 && y === 0) return true;
      if (x * x + y * y > L * L) return false;
      // smallest signed angle between the point and the aim direction, in (-pi, pi]
      const d = Math.atan2(y, x) - ang;
      const norm = Math.atan2(Math.sin(d), Math.cos(d));
      return Math.abs(norm) <= HALF + 1e-9;
    }
    // line: 1-square-wide ray on the +perpendicular side of the travel axis
    const u = x * f.x + y * f.y;
    const v = x * p.x + y * p.y;
    return u >= -1e-9 && u <= L + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9;
  };

  const N = 7; // 7x7 sub-samples per square
  const R = Math.ceil(L) + 1;
  const cells: CellOffset[] = [];
  for (let a = -R; a <= R; a++) {
    for (let b = -R; b <= R; b++) {
      let hit = 0;
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++)
          if (inside(a + (i + 0.5) / N, b + (j + 0.5) / N)) hit++;
      if (hit / (N * N) >= 0.5) cells.push({ x: a, y: b });
    }
  }
  return cells;
}

const SIZES: SizeDef[] = [
  { id: "fine", label: "Fine", footprint: 1, spaceFt: 0.5, reachFt: 0, scale: 0.1 },
  { id: "diminutive", label: "Diminutive", footprint: 1, spaceFt: 1, reachFt: 0, scale: 0.2 },
  { id: "tiny", label: "Tiny", footprint: 1, spaceFt: 2.5, reachFt: 0, scale: 0.5 },
  { id: "small", label: "Small", footprint: 1, spaceFt: 5, reachFt: 5, scale: 1 },
  { id: "medium", label: "Medium", footprint: 1, spaceFt: 5, reachFt: 5, scale: 1 },
  { id: "large", label: "Large", footprint: 2, spaceFt: 10, reachFt: 10, scale: 1 },
  { id: "huge", label: "Huge", footprint: 3, spaceFt: 15, reachFt: 15, scale: 1 },
  { id: "gargantuan", label: "Gargantuan", footprint: 4, spaceFt: 20, reachFt: 20, scale: 1 },
  { id: "colossal", label: "Colossal", footprint: 6, spaceFt: 30, reachFt: 30, scale: 1 },
];

const CONDITION_ICON: Record<string, string> = {
  blinded: "👁", cowering: "😰", dazed: "😵", dazzled: "✨", dead: "💀",
  deafened: "🔇", entangled: "🕸", exhausted: "😩", fatigued: "😪", frightened: "😨",
  grappled: "🤼", nauseated: "🤢", panicked: "😱", paralyzed: "🧊", pinned: "📌",
  prone: "⬇️", shaken: "😬", sickened: "🤒", stunned: "💫", unconscious: "💤",
};

const DEFEATED = new Set(["dead", "unconscious"]);

const CONDITIONS: ConditionDef[] = [
  "blinded", "cowering", "dazed", "dazzled", "dead", "deafened", "entangled",
  "exhausted", "fatigued", "frightened", "grappled", "nauseated", "panicked",
  "paralyzed", "pinned", "prone", "shaken", "sickened", "stunned", "unconscious",
].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), icon: CONDITION_ICON[id], defeated: DEFEATED.has(id) }));

export const dnd35: Ruleset = {
  meta: { id: "dnd35", name: "D&D 3.5e", version: "1.0.0" },
  grid: { kind: "square", cellFt: 5 },
  conditions: CONDITIONS,
  sizes: SIZES,
  characterSchema: [
    { key: "damage", label: "Damage taken", type: "number", default: 0, group: "Status" },
    { key: "initiative", label: "Initiative", type: "number", default: 0, group: "Combat" },
    { key: "initiativeMod", label: "Initiative mod", type: "number", default: 0, group: "Combat" },
    { key: "ac", label: "AC", type: "number", group: "Defenses" },
    { key: "touchAc", label: "Touch AC", type: "number", group: "Defenses" },
    { key: "flatFootedAc", label: "Flat-footed AC", type: "number", group: "Defenses" },
  ],

  createBlankAttributes() {
    return { damage: 0, initiative: 0, initiativeMod: 0 };
  },

  rollInitiative(entity: Entity): number {
    const mod = Number(entity.attributes?.initiativeMod ?? 0);
    return Math.floor(Math.random() * 20) + 1 + mod;
  },

  measureDistanceFt(from: CellOffset, to: CellOffset): number {
    return diagDistance(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  },

  reachCells(sizeId: string, reachFtOverride?: number): CellOffset[] {
    const def = SIZES.find((s) => s.id === sizeId);
    if (!def) return [];
    const reachFt = reachFtOverride ?? def.reachFt;
    if (reachFt <= 0) return [];
    const sq = def.footprint;
    const R = Math.ceil(reachFt / 5);
    const cells: CellOffset[] = [];
    for (let x = -R; x < sq + R; x++) {
      for (let y = -R; y < sq + R; y++) {
        if (x >= 0 && x < sq && y >= 0 && y < sq) continue;
        let best = Infinity;
        for (let fx = 0; fx < sq; fx++) {
          for (let fy = 0; fy < sq; fy++) {
            best = Math.min(best, diagDistance(Math.abs(x - fx), Math.abs(y - fy)));
          }
        }
        if (best <= reachFt) cells.push({ x, y });
      }
    }
    return cells;
  },

  aoeCells: computeAoeCells,
};

registerRuleset(dnd35);
