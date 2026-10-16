import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  MARKER_HEIGHT,
  MARKER_REF_Y,
  RELATION_MARKER_SHAPES,
  relationAnchors,
  relationPath,
  selfLoopPath,
  startMarkerKind,
} from "./edgeGeometry";

const box = (x: number, y: number) => ({ x, y, width: 240, height: 100 });

describe("relationAnchors", () => {
  it("connects stacked nodes through their facing top and bottom edges", () => {
    const [from, to] = relationAnchors(box(0, 300), 50, box(20, 0), 30);
    expect(from).toEqual({ x: 120, y: 300, position: Position.Top });
    expect(to).toEqual({ x: 140, y: 100, position: Position.Bottom });

    const [down, up] = relationAnchors(box(0, 0), 50, box(0, 300), 30);
    expect(down.position).toBe(Position.Bottom);
    expect(up.position).toBe(Position.Top);
  });

  it("connects nodes beside each other at the key rows", () => {
    const [from, to] = relationAnchors(box(0, 0), 50, box(400, 20), 30);
    expect(from).toEqual({ x: 240, y: 50, position: Position.Right });
    expect(to).toEqual({ x: 400, y: 50, position: Position.Left });

    const [left, right] = relationAnchors(box(400, 0), 50, box(0, 0), 30);
    expect(left.position).toBe(Position.Left);
    expect(right.position).toBe(Position.Right);
  });

  it("prefers the axis with more room and bends around overlapping nodes", () => {
    const [from, to] = relationAnchors(box(0, 0), 50, box(300, 200), 30);
    expect(from.position).toBe(Position.Bottom);
    expect(to.position).toBe(Position.Top);

    const [same, other] = relationAnchors(box(0, 0), 50, box(100, 50), 30);
    expect(same.position).toBe(Position.Right);
    expect(other.position).toBe(Position.Right);
  });

  it("draws self-references as a loop on the right side", () => {
    const [path, labelX, labelY] = selfLoopPath(box(10, 20), 40, 60);
    expect(path).toBe("M 250,60 C 294,60 294,80 250,80");
    expect(labelX).toBe(290);
    expect(labelY).toBe(70);
  });
});

describe("relationPath", () => {
  it("loops a self-reference and steps between the anchors otherwise", () => {
    const [loop, loopLabelX, loopLabelY] = relationPath(box(10, 20), 40, box(10, 20), 60, true);
    expect(loop).toBe("M 250,60 C 294,60 294,80 250,80");
    expect([loopLabelX, loopLabelY]).toEqual([290, 70]);

    // Side by side at the same height: a straight run from anchor to anchor, label midway.
    const [path, labelX, labelY] = relationPath(box(0, 0), 50, box(400, 20), 30, false);
    expect(path.startsWith("M240 50")).toBe(true);
    expect(path.endsWith("400 50")).toBe(true);
    expect(path).not.toContain("Q");
    expect([labelX, labelY]).toEqual([320, 50]);

    // Different heights: the step bends, with rounded corners.
    const [bent] = relationPath(box(0, 0), 50, box(400, 60), 30, false);
    expect(bent.startsWith("M240 50")).toBe(true);
    expect(bent.endsWith("400 90")).toBe(true);
    expect(bent).toContain("Q");
  });
});

describe("crow's foot markers", () => {
  it("has one shape per end, all the same height, pointing into the path", () => {
    expect(Object.keys(RELATION_MARKER_SHAPES)).toEqual(["many", "manyOptional", "one"]);
    expect(MARKER_HEIGHT).toBe(14);
    expect(MARKER_REF_Y).toBe(7);
    expect(RELATION_MARKER_SHAPES.many).toMatchObject({
      width: 14,
      refX: 1,
      orient: "auto-start-reverse",
    });
    expect(RELATION_MARKER_SHAPES.manyOptional).toMatchObject({
      width: 22,
      refX: 1,
      path: RELATION_MARKER_SHAPES.many.path,
      circle: { cx: 17, cy: 7, r: 3 },
    });
    expect(RELATION_MARKER_SHAPES.one).toMatchObject({ width: 14, refX: 13, orient: "auto" });
    expect(RELATION_MARKER_SHAPES.many.circle).toBeUndefined();
  });

  it("marks an optional key with the zero-or-many end", () => {
    expect(startMarkerKind(true)).toBe("manyOptional");
    expect(startMarkerKind(false)).toBe("many");
  });
});
