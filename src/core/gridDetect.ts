// src/core/gridDetect.ts
//
// Heuristic battle-map grid detection — NO AI, runs entirely in the browser on
// the uploaded image File (so there's no CORS/canvas-tainting concern).
//
// How it works:
//  1. Decode + downscale the image, convert to grayscale.
//  2. Build "edge projection profiles": for each column, sum the horizontal
//     gradient (strong at vertical grid lines); same per row for horizontal lines.
//  3. Autocorrelate each profile to find its dominant period = cell size.
//  4. Find the phase (where the lines actually sit) = grid offset.
//
// Returns values in the image's NATURAL pixels (which is the map's coordinate
// space), or null if no convincing periodic grid is found (e.g. plain artwork).

export interface GridGuess {
  cellPx: number;
  offsetX: number;
  offsetY: number;
  confidence: number; // ~0..1, higher = clearer grid
}

const ANALYZE_MAX = 1100; // longest side used for analysis (px) — keeps it fast

export async function detectGrid(file: Blob): Promise<GridGuess | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, ANALYZE_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) { bmp.close?.(); return null; }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  const col = new Float32Array(w); // vertical-edge strength per column
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) col[x] += Math.abs(gray[row + x + 1] - gray[row + x - 1]);
  }
  const rowP = new Float32Array(h); // horizontal-edge strength per row
  for (let y = 1; y < h - 1; y++) {
    for (let x = 0; x < w; x++) rowP[y] += Math.abs(gray[(y + 1) * w + x] - gray[(y - 1) * w + x]);
  }

  const ax = analyzeAxis(col, w);
  const ay = analyzeAxis(rowP, h);
  if (!ax && !ay) return null;

  // Square grid: take the period from the more confident axis.
  const best = ax && ay ? (ax.conf >= ay.conf ? ax : ay) : (ax ?? ay)!;
  const confidence = Math.max(ax?.conf ?? 0, ay?.conf ?? 0);
  if (confidence < 0.1) return null; // no convincing grid

  const cellPx = best.period / scale;
  const wrap = (v: number) => ((v % cellPx) + cellPx) % cellPx;
  return {
    cellPx,
    offsetX: wrap((ax?.phase ?? best.phase) / scale),
    offsetY: wrap((ay?.phase ?? best.phase) / scale),
    confidence,
  };
}

interface AxisResult { period: number; phase: number; conf: number; }

function analyzeAxis(raw: Float32Array, n: number): AxisResult | null {
  // Detrend to remove broad lighting gradients.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += raw[i];
  mean /= n || 1;
  const prof = new Float32Array(n);
  for (let i = 0; i < n; i++) prof[i] = raw[i] - mean;

  const minP = Math.max(6, Math.floor(n / 60)); // up to ~60 cells across
  const maxP = Math.max(minP + 1, Math.floor(n / 4)); // at least ~4 cells across
  let norm = 0;
  for (let i = 0; i < n; i++) norm += prof[i] * prof[i];
  norm = norm || 1;

  const score = (p: number) => {
    let s = 0;
    for (let i = 0; i + p < n; i++) s += prof[i] * prof[i + p];
    return s / norm;
  };

  let bestP = 0, bestScore = 0;
  for (let p = minP; p <= maxP; p++) {
    const sc = score(p);
    if (sc > bestScore) { bestScore = sc; bestP = p; }
  }
  if (!bestP) return null;

  // Prefer the fundamental period over a harmonic (2x/3x/4x).
  for (let k = 4; k >= 2; k--) {
    const pk = Math.round(bestP / k);
    if (pk >= minP && score(pk) >= bestScore * 0.8) { bestP = pk; break; }
  }

  // Phase: the position within one period whose lines have the most edge energy.
  let bestPhase = 0, bestVal = -Infinity;
  for (let ph = 0; ph < bestP; ph++) {
    let s = 0;
    for (let i = ph; i < n; i += bestP) s += raw[i];
    if (s > bestVal) { bestVal = s; bestPhase = ph; }
  }

  return { period: bestP, phase: bestPhase, conf: bestScore };
}
