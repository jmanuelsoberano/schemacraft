import { describe, expect, it } from "vitest";

import { resolveOverlaps } from "./overlaps";

const box = (id: string, x: number, y: number, height: number) => ({
  id,
  x,
  y,
  width: 240,
  height,
});

describe("resolveOverlaps", () => {
  it("leaves boxes alone when nothing overlaps", () => {
    const boxes = [box("a", 0, 0, 100), box("b", 0, 200, 100), box("c", 300, 50, 100)];
    const resolved = resolveOverlaps(boxes);
    expect([...resolved.entries()]).toEqual([
      ["a", { x: 0, y: 0 }],
      ["c", { x: 300, y: 50 }],
      ["b", { x: 0, y: 200 }],
    ]);
  });

  it("pushes a box below the taller box above it, keeping the gap", () => {
    const resolved = resolveOverlaps([box("a", 0, 0, 300), box("b", 0, 120, 100)]);
    expect(resolved.get("a")).toEqual({ x: 0, y: 0 });
    expect(resolved.get("b")).toEqual({ x: 0, y: 324 });
  });

  it("cascades down a column and ignores boxes beside it", () => {
    const resolved = resolveOverlaps([
      box("a", 0, 0, 200),
      box("b", 0, 100, 200),
      box("c", 0, 200, 50),
      box("side", 240, 0, 1000),
    ]);
    expect(resolved.get("b")).toEqual({ x: 0, y: 224 });
    expect(resolved.get("c")).toEqual({ x: 0, y: 448 });
    expect(resolved.get("side")).toEqual({ x: 240, y: 0 });
  });

  it("is deterministic for boxes that share a row", () => {
    const first = resolveOverlaps([box("b", 10, 0, 100), box("a", 0, 0, 100)]);
    const second = resolveOverlaps([box("a", 0, 0, 100), box("b", 10, 0, 100)]);
    expect([...first.entries()]).toEqual([...second.entries()]);
    expect(first.get("b")).toEqual({ x: 10, y: 124 });
  });
});
