import { describe, it, expect } from "vitest";
import { dnd35 } from "./dnd35";

const d = (ax: number, ay: number, bx: number, by: number) =>
  dnd35.measureDistanceFt({ x: ax, y: ay }, { x: bx, y: by });

describe("dnd35 ruleset", () => {
  it("exposes 9 sizes and the 20 canonical conditions", () => {
    expect(dnd35.sizes.length).toBe(9);
    expect(dnd35.conditions.length).toBe(20);
    const medium = dnd35.sizes.find((s) => s.id === "medium");
    expect(medium).toMatchObject({ footprint: 1, spaceFt: 5, reachFt: 5 });
  });

  it("measures distance with the 3.5e 1-2-1 diagonal rule", () => {
    expect(d(0, 0, 3, 0)).toBe(15); // straight
    expect(d(0, 0, 1, 1)).toBe(5);  // first diagonal counts as 1
    expect(d(0, 0, 2, 2)).toBe(15); // second diagonal counts as 2 (5 + 10)
    expect(d(0, 0, 3, 3)).toBe(20); // 5 + 10 + 5
    expect(d(0, 0, 5, 5)).toBe(35); // 5+10+5+10+5
    expect(d(2, 2, 0, 0)).toBe(15); // symmetric
  });

  it("threatens the 8 adjacent squares at Medium reach", () => {
    const cells = dnd35.reachCells("medium");
    expect(cells.length).toBe(8);
    expect(cells.some((c) => c.x === 0 && c.y === 0)).toBe(false); // not its own square
    expect(cells.some((c) => c.x === 1 && c.y === 1)).toBe(true);  // includes diagonals
  });

  it("expands the threatened area for a reach weapon", () => {
    const normal = dnd35.reachCells("medium");
    const reach = dnd35.reachCells("medium", 10);
    expect(reach.length).toBeGreaterThan(normal.length);
  });

  it("produces a non-empty burst template", () => {
    const cells = dnd35.aoeCells?.({ shape: "burst", sizeFt: 20, cellFt: 5 }) ?? [];
    expect(cells.length).toBeGreaterThan(0);
  });
});
