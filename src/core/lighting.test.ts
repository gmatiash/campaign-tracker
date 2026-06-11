import { describe, it, expect } from "vitest";
import { computeLighting } from "./lighting";

const base = { cols: 11, rows: 11, cellFt: 5, walls: [] as Array<[[number, number], [number, number]]> };

describe("computeLighting", () => {
  it("lights bright within the radius, dim out to 2x, dark beyond", () => {
    const out = computeLighting({ ...base, sources: [{ gx: 5, gy: 5, shape: "radial", brightFt: 10 }] });
    expect(out.get("5,5")).toBe(2);      // source cell
    expect(out.get("7,5")).toBe(2);      // 10 ft -> bright edge
    expect(out.get("8,5")).toBe(1);      // 15 ft -> shadowy (within 20)
    expect(out.get("9,5")).toBe(1);      // 20 ft -> shadowy edge
    expect(out.has("10,5")).toBe(false); // 25 ft -> dark
  });

  it("occludes light behind a wall", () => {
    const wall: [[number, number], [number, number]] = [[6, 5], [6, 6]];
    const out = computeLighting({ ...base, walls: [wall], sources: [{ gx: 5, gy: 5, shape: "radial", brightFt: 15 }] });
    expect(out.get("5,5")).toBe(2);      // source lit
    expect(out.get("4,5")).toBe(2);      // open side lit
    expect(out.has("6,5")).toBe(false);  // blocked by the wall edge
  });

  it("doubles ranges for a low-light viewer", () => {
    const src = { gx: 5, gy: 5, shape: "radial" as const, brightFt: 10 };
    const normal = computeLighting({ ...base, sources: [src], viewer: { gx: 5, gy: 5 } });
    const low = computeLighting({ ...base, sources: [src], viewer: { gx: 5, gy: 5, lowLight: true } });
    expect(normal.get("9,5")).toBe(1); // 20 ft is shadowy at 10 ft bright
    expect(low.get("9,5")).toBe(2);    // low-light doubles bright to 20 ft
  });

  it("gives darkvision a bright radius in the dark", () => {
    const out = computeLighting({ ...base, sources: [], viewer: { gx: 5, gy: 5, darkvisionFt: 10 } });
    expect(out.get("5,5")).toBe(2);
    expect(out.get("7,5")).toBe(2);      // within 10 ft
    expect(out.has("8,5")).toBe(false);  // beyond darkvision
  });

  it("masks lit cells the viewer cannot see (field of view)", () => {
    const wall: [[number, number], [number, number]] = [[6, 5], [6, 6]];
    const out = computeLighting({ ...base, walls: [wall], sources: [{ gx: 8, gy: 5, shape: "radial", brightFt: 15 }], viewer: { gx: 5, gy: 5 } });
    expect(out.has("8,5")).toBe(false); // the lit source is behind a wall from the viewer
  });

  it("ambient bright lights the whole map (god view, no viewer)", () => {
    const out = computeLighting({ ...base, sources: [], ambient: "bright" });
    expect(out.get("0,0")).toBe(2);
    expect(out.get("10,10")).toBe(2);
  });
});
