import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";

import type { SchemaSnapshot } from "@/shared/contracts";

import { describeEntities } from "../geometry";
import { relatedEntityKeys } from "../neighborhood";
import { fromElkGraph, layeredLayout, toElkGraph } from "./layered";
import { buildLayoutInput, normalizePositions } from "./layoutGraph";
import type { LayoutInput } from "./layoutGraph";
import { organicLayout } from "./organic";
import { placeNearRelated } from "./placement";
import { mostConnectedNode, radialLayout, ringsFrom } from "./radial";

function table(schema: string, name: string) {
  return {
    name: { schema, name },
    columns: [],
    primaryKey: null,
    indexes: [],
    checkConstraints: [],
  };
}

function foreignKey(from: string, to: string) {
  const [fromSchema = "dbo", fromName = ""] = from.split(".");
  const [toSchema = "dbo", toName = ""] = to.split(".");
  return {
    name: `FK_${fromName}_${toName}`,
    referencingTable: { schema: fromSchema, name: fromName },
    referencedTable: { schema: toSchema, name: toName },
    columnPairs: [],
    onDelete: "noAction" as const,
    onUpdate: "noAction" as const,
    isEnabled: true,
  };
}

// Customers <- Orders <- OrderLines; Tags isolated; Employees self-referencing.
const snapshot: SchemaSnapshot = {
  databaseName: "Shop",
  serverVersion: null,
  extractedAt: "2026-10-13T18:00:00Z",
  tables: [
    table("dbo", "Customers"),
    table("sales", "Orders"),
    table("sales", "OrderLines"),
    table("dbo", "Tags"),
    table("hr", "Employees"),
  ],
  views: [],
  foreignKeys: [
    foreignKey("sales.Orders", "dbo.Customers"),
    foreignKey("sales.OrderLines", "sales.Orders"),
    foreignKey("hr.Employees", "hr.Employees"),
  ],
};

function input(positions = new Map<string, { x: number; y: number }>()): LayoutInput {
  const entities = describeEntities(snapshot);
  return buildLayoutInput(
    snapshot,
    entities,
    new Set(entities.keys()),
    "compact",
    new Set(),
    positions,
  );
}

function assertNoOverlap(layout: LayoutInput, positions: Map<string, { x: number; y: number }>) {
  const boxes = layout.nodes.map((node) => {
    const point = positions.get(node.id);
    if (point === undefined) {
      throw new Error(`missing position for ${node.id}`);
    }
    return { ...node, ...point };
  });
  for (const a of boxes) {
    for (const b of boxes) {
      if (a.id === b.id) continue;
      const apart =
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y;
      expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
    }
  }
}

describe("buildLayoutInput", () => {
  it("keeps visible nodes and drops self-references", () => {
    const layout = input();
    expect(layout.nodes.map((node) => node.id)).toEqual([
      "dbo.Customers",
      "sales.Orders",
      "sales.OrderLines",
      "dbo.Tags",
      "hr.Employees",
    ]);
    expect(layout.edges.map((edge) => `${edge.source}>${edge.target}`)).toEqual([
      "sales.Orders>dbo.Customers",
      "sales.OrderLines>sales.Orders",
    ]);
    expect(layout.nodes[0]?.height).toBe(38);
  });

  it("normalises positions towards the origin", () => {
    const normalized = normalizePositions(
      new Map([
        ["a", { x: -100, y: 500 }],
        ["b", { x: 50, y: 700 }],
      ]),
      10,
    );
    expect(normalized.get("a")).toEqual({ x: 10, y: 10 });
    expect(normalized.get("b")).toEqual({ x: 160, y: 210 });
  });
});

describe("layered layout", () => {
  it("puts referenced tables above the tables that use them", async () => {
    const layout = input();
    const graph = toElkGraph(layout, "down");
    expect(graph.edges?.[0]).toMatchObject({
      sources: ["dbo.Customers"],
      targets: ["sales.Orders"],
    });

    const positions = await layeredLayout(layout, "down", () => new ELK());
    const y = (id: string) => positions.get(id)?.y ?? Number.NaN;
    expect(y("dbo.Customers")).toBeLessThan(y("sales.Orders"));
    expect(y("sales.Orders")).toBeLessThan(y("sales.OrderLines"));
    assertNoOverlap(layout, positions);

    const horizontal = await layeredLayout(layout, "right", () => new ELK());
    const x = (id: string) => horizontal.get(id)?.x ?? Number.NaN;
    expect(x("dbo.Customers")).toBeLessThan(x("sales.Orders"));
    expect(fromElkGraph({ id: "root", children: [{ id: "n", x: 5, y: 7 }] }).get("n")).toEqual({
      x: 40,
      y: 40,
    });
  });
});

describe("organic layout", () => {
  it("is deterministic and keeps boxes apart", () => {
    const layout = input();
    const first = organicLayout(layout);
    const second = organicLayout(layout);
    expect([...first.entries()]).toEqual([...second.entries()]);
    assertNoOverlap(layout, first);
    expect(organicLayout({ nodes: [], edges: [], positions: new Map() }).size).toBe(0);
  });
});

describe("radial layout", () => {
  it("rings nodes by relationship distance from the focus", () => {
    const layout = input();
    expect(mostConnectedNode(layout)).toBe("sales.Orders");
    expect(ringsFrom(layout, "dbo.Customers")).toEqual([
      ["dbo.Customers"],
      ["sales.Orders"],
      ["sales.OrderLines"],
      ["dbo.Tags", "hr.Employees"],
    ]);
    const positions = radialLayout(layout, "dbo.Customers");
    expect(positions.size).toBe(5);
    assertNoOverlap(layout, positions);
    expect(radialLayout(layout, "missing").size).toBe(5);
  });
});

describe("placeNearRelated", () => {
  it("puts new tables beside their relatives and orphans under the diagram", () => {
    const positions = new Map([
      ["dbo.Customers", { x: 0, y: 0 }],
      ["sales.Orders", { x: 0, y: 200 }],
    ]);
    const layout = input(positions);
    const placed = placeNearRelated(layout, ["sales.OrderLines", "dbo.Tags", "hr.Employees"]);

    const lines = placed.get("sales.OrderLines");
    expect(lines).toBeDefined();
    expect(lines?.x).toBe(300);
    expect(lines?.y).toBe(200);

    const tags = placed.get("dbo.Tags");
    const employees = placed.get("hr.Employees");
    expect(tags?.y).toBeGreaterThan(200);
    expect(employees?.y).toBe(tags?.y);
    expect(employees?.x).toBeGreaterThan(tags?.x ?? 0);

    const all = new Map([...positions, ...placed]);
    assertNoOverlap(layout, all);
  });
});

describe("relatedEntityKeys", () => {
  it("walks relationships in both directions up to the requested depth", () => {
    expect([...relatedEntityKeys(snapshot, "sales.Orders", 1)].sort()).toEqual([
      "dbo.Customers",
      "sales.OrderLines",
      "sales.Orders",
    ]);
    expect([...relatedEntityKeys(snapshot, "dbo.Customers", 1)].sort()).toEqual([
      "dbo.Customers",
      "sales.Orders",
    ]);
    expect([...relatedEntityKeys(snapshot, "dbo.Customers", 2)].sort()).toEqual([
      "dbo.Customers",
      "sales.OrderLines",
      "sales.Orders",
    ]);
    expect([...relatedEntityKeys(snapshot, "dbo.Tags", 2)]).toEqual(["dbo.Tags"]);
  });
});
