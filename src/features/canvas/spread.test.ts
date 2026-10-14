import { describe, expect, it } from "vitest";

import type { CanvasState, Column, SchemaSnapshot } from "@/shared/contracts";

import { spreadForDetailLevel, withPositions } from "./canvasState";
import { nodeHeight } from "./geometry";

function column(name: string): Column {
  return {
    name,
    ordinalPosition: 0,
    dataType: {
      name: "int",
      length: null,
      precision: null,
      scale: null,
      userDefinedTypeName: null,
    },
    isNullable: false,
    defaultExpression: null,
    isIdentity: false,
    isComputed: false,
  };
}

const columns = ["Id", "A", "B", "C", "D", "E"].map(column);

const snapshot: SchemaSnapshot = {
  databaseName: "Shop",
  serverVersion: null,
  extractedAt: "2026-10-13T18:00:00Z",
  tables: [
    {
      name: { schema: "dbo", name: "Top" },
      columns,
      primaryKey: { name: "PK_Top", columns: ["Id"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
    {
      name: { schema: "dbo", name: "Below" },
      columns,
      primaryKey: { name: "PK_Below", columns: ["Id"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
    {
      name: { schema: "dbo", name: "Hidden" },
      columns,
      primaryKey: null,
      indexes: [],
      checkConstraints: [],
    },
  ],
  views: [],
  foreignKeys: [],
};

// Laid out at the keys level: one key row each, so 100 px apart is plenty of room.
const canvas: CanvasState = {
  detailLevel: "keys",
  layout: "layered",
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    {
      name: { schema: "dbo", name: "Top" },
      position: { x: 0, y: 0 },
      isCollapsed: false,
      isHidden: false,
    },
    {
      name: { schema: "dbo", name: "Below" },
      position: { x: 0, y: 100 },
      isCollapsed: false,
      isHidden: false,
    },
    {
      name: { schema: "dbo", name: "Hidden" },
      position: { x: 0, y: 50 },
      isCollapsed: false,
      isHidden: true,
    },
  ],
};

describe("spreadForDetailLevel", () => {
  it("moves nothing when the level fits the positions", () => {
    expect(spreadForDetailLevel(snapshot, canvas, "keys").size).toBe(0);
    expect(spreadForDetailLevel(snapshot, canvas, "compact").size).toBe(0);
  });

  it("moves the lower table below a table that grows at the full level, ignoring hidden ones", () => {
    const moved = spreadForDetailLevel(snapshot, canvas, "full");
    expect([...moved.keys()]).toEqual(["dbo.Below"]);
    expect(moved.get("dbo.Below")).toEqual({ x: 0, y: nodeHeight(columns.length) + 24 });

    const spread = withPositions(canvas, moved);
    expect(spread.layout).toBe("manual");
    expect(spread.nodes.find((node) => node.name.name === "Hidden")?.position).toEqual({
      x: 0,
      y: 50,
    });
  });

  it("respects collapsed tables, which never grow", () => {
    const collapsed: CanvasState = {
      ...canvas,
      nodes: canvas.nodes.map((node) =>
        node.name.name === "Top" ? { ...node, isCollapsed: true } : node,
      ),
    };
    expect(spreadForDetailLevel(snapshot, collapsed, "full").size).toBe(0);
  });
});
