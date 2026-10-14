import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { relationAnchors, selfLoopPath } from "./edgeGeometry";

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
