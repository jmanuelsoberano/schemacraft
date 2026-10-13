import { describe, expect, it } from "vitest";

import type { CanvasState, SchemaSnapshot } from "@/shared/contracts";

import {
  ensurePlaced,
  nodeStateFor,
  nodesBounds,
  toggleCollapsed,
  withHidden,
  withLayout,
  withOnlyVisible,
  withPositions,
} from "./canvasState";

const snapshot: SchemaSnapshot = {
  databaseName: "Shop",
  serverVersion: null,
  extractedAt: "2026-10-13T18:00:00Z",
  tables: [
    {
      name: { schema: "dbo", name: "A" },
      columns: [],
      primaryKey: null,
      indexes: [],
      checkConstraints: [],
    },
    {
      name: { schema: "dbo", name: "B" },
      columns: [],
      primaryKey: null,
      indexes: [],
      checkConstraints: [],
    },
  ],
  views: [{ name: { schema: "dbo", name: "V" }, columns: [] }],
  foreignKeys: [],
};

const empty: CanvasState = {
  detailLevel: "keys",
  layout: "manual",
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
};

describe("ensurePlaced", () => {
  it("places every entity on a grid and keeps the result stable", () => {
    const placed = ensurePlaced(empty, snapshot);
    expect(placed.nodes.map((node) => node.name.name)).toEqual(["A", "B", "V"]);
    expect(placed.nodes[0]?.position).toEqual({ x: 0, y: 0 });
    expect(placed.nodes[1]?.position.x).toBeGreaterThan(0);
    expect(ensurePlaced(placed, snapshot)).toBe(placed);
  });

  it("keeps saved positions, drops vanished entities and places new ones below", () => {
    const saved: CanvasState = {
      ...empty,
      nodes: [
        {
          name: { schema: "dbo", name: "A" },
          position: { x: 500, y: 300 },
          isCollapsed: true,
          isHidden: false,
        },
        {
          name: { schema: "dbo", name: "Gone" },
          position: { x: 0, y: 0 },
          isCollapsed: false,
          isHidden: false,
        },
      ],
    };
    const placed = ensurePlaced(saved, snapshot);
    expect(placed.nodes.map((node) => node.name.name)).toEqual(["A", "B", "V"]);
    expect(nodeStateFor(placed, "dbo.A")).toMatchObject({
      position: { x: 500, y: 300 },
      isCollapsed: true,
    });
    expect(nodeStateFor(placed, "dbo.B")?.position.y).toBeGreaterThan(300);
  });
});

describe("canvas mutations", () => {
  const base = ensurePlaced(empty, snapshot);

  it("moves nodes and marks the layout as manual, returning the same state when nothing moved", () => {
    const layered = { ...base, layout: "layered" as const };
    const moved = withPositions(layered, new Map([["dbo.B", { x: 10, y: 20 }]]));
    expect(nodeStateFor(moved, "dbo.B")?.position).toEqual({ x: 10, y: 20 });
    expect(moved.layout).toBe("manual");
    expect(withPositions(moved, new Map([["dbo.B", { x: 10, y: 20 }]]))).toBe(moved);
  });

  it("applies a layout to every placed node and records its kind", () => {
    const laid = withLayout(
      base,
      new Map([
        ["dbo.A", { x: 1, y: 2 }],
        ["dbo.V", { x: 3, y: 4 }],
      ]),
      "organic",
    );
    expect(laid.layout).toBe("organic");
    expect(nodeStateFor(laid, "dbo.A")?.position).toEqual({ x: 1, y: 2 });
    expect(nodeStateFor(laid, "dbo.V")?.position).toEqual({ x: 3, y: 4 });
  });

  it("hides, isolates and collapses entities", () => {
    const hidden = withHidden(base, ["dbo.A"], true);
    expect(nodeStateFor(hidden, "dbo.A")?.isHidden).toBe(true);
    expect(withHidden(hidden, ["dbo.A"], true)).toBe(hidden);

    const only = withOnlyVisible(base, new Set(["dbo.B"]));
    expect(only.nodes.map((node) => node.isHidden)).toEqual([true, false, true]);

    const collapsed = toggleCollapsed(base, "dbo.V");
    expect(nodeStateFor(collapsed, "dbo.V")?.isCollapsed).toBe(true);
    expect(nodeStateFor(toggleCollapsed(collapsed, "dbo.V"), "dbo.V")?.isCollapsed).toBe(false);
    expect(toggleCollapsed(base, "dbo.Missing")).toBe(base);
  });

  it("measures the bounds of the placed nodes", () => {
    expect(nodesBounds(empty)).toBeNull();
    const bounds = nodesBounds(base, () => 100);
    expect(bounds?.x).toBe(0);
    expect(bounds?.y).toBe(0);
    expect(bounds?.width).toBeGreaterThan(240);
    expect(bounds?.height).toBe(100);
  });
});
