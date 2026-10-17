import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  MARKER_HEIGHT,
  MARKER_ORIENT,
  MARKER_REF_Y,
  RELATION_MARKER_SHAPES,
  endMarkerKind,
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

  it("starts the loop at the referencing row, where the crow's foot goes, below the key or above", () => {
    // ManagerId under EmployeeId: the loop runs upwards, from ManagerId to EmployeeId.
    const [upwards, labelX, labelY] = selfLoopPath(box(10, 20), 60, 40);
    expect(upwards).toBe("M 250,80 C 294,80 294,60 250,60");
    expect([labelX, labelY]).toEqual([290, 70]);
  });

  it("keeps the two ends of a loop apart when both attach at the header", () => {
    // A collapsed card: both ends at the middle of its 38 px header, then 8 px up and down.
    const [path, labelX, labelY] = selfLoopPath(box(10, 20), 19, 19);
    expect(path).toBe("M 250,31 C 294,31 294,47 250,47");
    expect([labelX, labelY]).toEqual([290, 39]);
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
  it("has one shape per meaning, all the same height, each touching its table", () => {
    expect(Object.keys(RELATION_MARKER_SHAPES)).toEqual(["many", "one", "zeroOrOne"]);
    expect(MARKER_HEIGHT).toBe(14);
    expect(MARKER_REF_Y).toBe(7);
    // Drawn facing the table on the right of the box, which the reversed start orientation
    // turns round at the referencing end. Any stroke right of the reference point would be
    // drawn under the card, where nothing shows.
    expect(MARKER_ORIENT).toBe("auto-start-reverse");
    for (const shape of Object.values(RELATION_MARKER_SHAPES)) {
      expect(shape.refX).toBe(shape.width - 1);
    }
    expect(RELATION_MARKER_SHAPES.many).toEqual({
      width: 14,
      refX: 13,
      path: "M1,7 L13,1 M1,7 L13,7 M1,7 L13,13",
    });
    expect(RELATION_MARKER_SHAPES.one).toEqual({
      width: 14,
      refX: 13,
      path: "M6,1 L6,13 M1,7 L13,7",
    });
    expect(RELATION_MARKER_SHAPES.zeroOrOne).toEqual({
      width: 22,
      refX: 21,
      path: "M14,1 L14,13 M1,7 L21,7",
      circle: { cx: 6, cy: 7, r: 3 },
    });
  });

  it("puts the bar of both one ends at the same distance from the table, the circle beyond it", () => {
    const barDistance = (kind: "one" | "zeroOrOne") => {
      const shape = RELATION_MARKER_SHAPES[kind];
      const bar = /^M(\d+),1 L\1,13/u.exec(shape.path);
      return shape.refX - Number(bar?.[1]);
    };
    expect(barDistance("one")).toBe(7);
    expect(barDistance("zeroOrOne")).toBe(7);
    const { circle, refX } = RELATION_MARKER_SHAPES.zeroOrOne;
    expect(circle).toBeDefined();
    expect(refX - (circle?.cx ?? 0) - (circle?.r ?? 0)).toBeGreaterThan(7);
  });

  it("draws zero or one at the referencing end only for a one-to-one key", () => {
    expect(startMarkerKind("atMostOne")).toBe("zeroOrOne");
    expect(startMarkerKind("many")).toBe("many");
    // A unique index may be filtered, so the crow's foot, which allows one, stays.
    expect(startMarkerKind("unknown")).toBe("many");
  });

  it("draws zero or one at the referenced end when a key column accepts NULL", () => {
    expect(endMarkerKind("optional")).toBe("zeroOrOne");
    expect(endMarkerKind("required")).toBe("one");
    expect(endMarkerKind("unknown")).toBe("one");
  });
});
