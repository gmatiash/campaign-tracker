// src/core/lighting.ts
//
// Cell-based dynamic lighting with wall occlusion (a light-weight "raycast":
// line-of-sight from a source cell center to each candidate cell center is
// tested against wall segments). Works on our grid + unit-edge walls.
//
// Output: a Map of "x,y" -> illumination level, 2 = bright (clear), 1 = dim
// (shadowy); cells absent from the map are dark.
//
// Rules modelled:
//  - A radial source lights `brightFt` clear + an equal band of shadowy (to 2x).
//  - A cone source does the same within a ~72° wedge aimed at `dir`.
//  - Low-light vision (on the viewer) DOUBLES both bands for every source.
//  - Darkvision (on the viewer) sees its own radius as bright, even unlit.
//  - Walls (and doors) block light and vision.

export type LightShape = "radial" | "cone";

export interface LightSrc {
  gx: number; gy: number;          // source cell
  shape: LightShape;
  brightFt: number;                // clear radius; shadowy extends to 2x this
  dir?: number;                    // degrees clockwise from +x (cone only)
}

export interface Viewer {
  gx: number; gy: number;
  lowLight?: boolean;
  darkvisionFt?: number;
}

export interface LightingInput {
  sources: LightSrc[];
  viewer?: Viewer | null;
  walls: Array<[[number, number], [number, number]]>; // segments in grid/intersection coords
  cols: number;
  rows: number;
  cellFt: number;
}

const CONE_HALF = Math.PI / 5; // ~36° half-angle (≈72° spread)

function ccw(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  return (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
}
// Do segments (1,2) and (3,4) properly intersect?
function segCross(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): boolean {
  return ccw(x1, y1, x3, y3, x4, y4) !== ccw(x2, y2, x3, y3, x4, y4)
    && ccw(x1, y1, x2, y2, x3, y3) !== ccw(x1, y1, x2, y2, x4, y4);
}

export function computeLighting(input: LightingInput): Map<string, 1 | 2> {
  const { sources, viewer, walls, cols, rows, cellFt } = input;
  const out = new Map<string, 1 | 2>();
  const bump = (x: number, y: number, lvl: 1 | 2) => {
    const k = `${x},${y}`;
    if ((out.get(k) ?? 0) < lvl) out.set(k, lvl);
  };
  const blocked = (x0: number, y0: number, x1: number, y1: number): boolean => {
    for (const [[ax, ay], [bx, by]] of walls) {
      if (segCross(x0, y0, x1, y1, ax, ay, bx, by)) return true;
    }
    return false;
  };

  // Cast one source: cells within radFt and visible get `bright` (2) up to brightFt, else `dim` (1).
  const cast = (gx: number, gy: number, radFt: number, brightFt: number, cone: number | null) => {
    const sx = gx + 0.5, sy = gy + 0.5;
    const maxC = Math.ceil(radFt / cellFt);
    for (let y = Math.max(0, gy - maxC); y <= Math.min(rows - 1, gy + maxC); y++) {
      for (let x = Math.max(0, gx - maxC); x <= Math.min(cols - 1, gx + maxC); x++) {
        const ddx = x - gx, ddy = y - gy;
        const distFt = Math.hypot(ddx, ddy) * cellFt;
        if (distFt > radFt) continue;
        if (cone !== null && (ddx || ddy)) {
          let diff = Math.atan2(ddy, ddx) - cone;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          if (Math.abs(diff) > CONE_HALF) continue;
        }
        if (blocked(sx, sy, x + 0.5, y + 0.5)) continue;
        bump(x, y, distFt <= brightFt ? 2 : 1);
      }
    }
  };

  const mul = viewer?.lowLight ? 2 : 1;
  for (const s of sources) {
    const bright = s.brightFt * mul;
    cast(s.gx, s.gy, bright * 2, bright, s.shape === "cone" ? (s.dir ?? 0) * Math.PI / 180 : null);
  }
  if (viewer?.darkvisionFt && viewer.darkvisionFt > 0) {
    // darkvision: own radius reads as bright regardless of lights
    cast(viewer.gx, viewer.gy, viewer.darkvisionFt, viewer.darkvisionFt, null);
  }
  return out;
}
