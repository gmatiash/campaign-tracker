// src/core/units.ts
// Distance units. Distances are stored canonically in FEET (the unit most
// tabletop rules are written in) and converted for DISPLAY via a per-campaign
// preference. This keeps rules math unit-free; only presentation changes.
//
// [future] A UI toggle will set Campaign.settings.distanceUnit; combat/map
// components should render distances through formatDistance() rather than
// hard-coding "ft".

export type DistanceUnit = "ft" | "m";

/**
 * Conversion mode:
 *  - "tabletop": the familiar grid convention where 5 ft == 1.5 m (0.3 m/ft).
 *  - "exact": true physical conversion (0.3048 m/ft).
 */
export type ConversionMode = "tabletop" | "exact";

const FT_TO_M_TABLETOP = 1.5 / 5; // 0.30 m per foot -> 5 ft = 1.5 m
const FT_TO_M_EXACT = 0.3048;

export interface UnitOptions {
  unit: DistanceUnit;
  mode?: ConversionMode; // default "tabletop"
}

export function convertFromFt(valueFt: number, opts: UnitOptions): number {
  if (opts.unit === "ft") return valueFt;
  return valueFt * (opts.mode === "exact" ? FT_TO_M_EXACT : FT_TO_M_TABLETOP);
}

export function formatDistance(valueFt: number, opts: UnitOptions): string {
  const v = convertFromFt(valueFt, opts);
  const rounded = Math.round(v * 10) / 10;
  return `${rounded} ${opts.unit}`;
}
