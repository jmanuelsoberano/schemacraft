import { describe, expect, it } from "vitest";

import type { Column, NodeState, SchemaSnapshot } from "@/shared/contracts";

import { describeEntities } from "./geometry";
import {
  buildEntityNodes,
  buildRelationEdges,
  countVisibleRelations,
  visibleEntityKeys,
} from "./graph";

function column(name: string, isNullable = false): Column {
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
    isNullable,
    defaultExpression: null,
    isIdentity: false,
    isComputed: false,
  };
}

const snapshot: SchemaSnapshot = {
  databaseName: "Shop",
  serverVersion: null,
  extractedAt: "2026-10-13T18:00:00Z",
  tables: [
    {
      name: { schema: "dbo", name: "Customers" },
      columns: [column("CustomerId"), column("Name")],
      primaryKey: { name: "PK", columns: ["CustomerId"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
    {
      name: { schema: "sales", name: "Orders" },
      columns: [column("OrderId"), column("CustomerId", true)],
      primaryKey: { name: "PK2", columns: ["OrderId"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
  ],
  views: [],
  foreignKeys: [
    {
      name: "FK_Orders_Customers",
      referencingTable: { schema: "sales", name: "Orders" },
      referencedTable: { schema: "dbo", name: "Customers" },
      columnPairs: [{ referencingColumn: "CustomerId", referencedColumn: "CustomerId" }],
      onDelete: "noAction",
      onUpdate: "noAction",
      isEnabled: true,
    },
  ],
};

const states: NodeState[] = [
  {
    name: { schema: "dbo", name: "Customers" },
    position: { x: 10, y: 20 },
    isCollapsed: false,
    isHidden: false,
  },
  {
    name: { schema: "sales", name: "Orders" },
    position: { x: 400, y: 20 },
    isCollapsed: true,
    isHidden: false,
  },
];

describe("buildEntityNodes", () => {
  const entities = describeEntities(snapshot);

  it("uses saved positions, collapse state and the detail level", () => {
    const nodes = buildEntityNodes(entities, states, "full", new Set(["sales.Orders"]));
    expect(nodes.map((node) => node.id)).toEqual(["dbo.Customers", "sales.Orders"]);
    expect(nodes[0]?.position).toEqual({ x: 10, y: 20 });
    expect(nodes[0]?.data.rows).toHaveLength(2);
    expect(nodes[1]?.data.rows).toHaveLength(0);
    expect(nodes[1]?.data.isCollapsed).toBe(true);
    expect(nodes[1]?.data.isHighlighted).toBe(true);
    expect(nodes[1]?.height).toBe(38);
  });

  it("skips hidden entities and places unplaced ones on a grid", () => {
    const hidden = states.slice(0, 1).map((state) => ({ ...state, isHidden: true }));
    const nodes = buildEntityNodes(entities, hidden, "keys");
    expect(nodes.map((node) => node.id)).toEqual(["sales.Orders"]);
    expect(nodes[0]?.position).toEqual({ x: 0, y: 0 });
    expect([...visibleEntityKeys(entities, hidden)]).toEqual(["sales.Orders"]);
  });

  it("tells which nodes have rows to hide, so a view at keys is a header-only card", () => {
    const withView = describeEntities({
      ...snapshot,
      views: [{ name: { schema: "sales", name: "RecentOrders" }, columns: [column("OrderId")] }],
    });
    const atKeys = buildEntityNodes(withView, states, "keys");
    expect(atKeys.map((node) => `${node.id}:${node.data.isCollapsible}`)).toEqual([
      "dbo.Customers:true",
      "sales.Orders:true",
      "sales.RecentOrders:false",
    ]);
    expect(atKeys[2]?.height).toBe(38);
    expect(buildEntityNodes(withView, states, "full")[2]?.data.isCollapsible).toBe(true);
    expect(
      buildEntityNodes(withView, states, "compact").every((node) => !node.data.isCollapsible),
    ).toBe(true);
  });
});

describe("buildRelationEdges", () => {
  const entities = describeEntities(snapshot);

  it("connects visible ends only and flags optional relationships", () => {
    const nodes = buildEntityNodes(entities, states, "keys");
    const edges = buildRelationEdges(snapshot, nodes);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.id).toBe("sales.Orders.FK_Orders_Customers");
    expect(edges[0]?.source).toBe("sales.Orders");
    expect(edges[0]?.target).toBe("dbo.Customers");
    expect(edges[0]?.data?.isOptional).toBe(true);

    const partial = buildEntityNodes(
      entities,
      states.map((state, index) => (index === 0 ? { ...state, isHidden: true } : state)),
      "keys",
    );
    expect(buildRelationEdges(snapshot, partial)).toEqual([]);
    expect(countVisibleRelations(snapshot, new Set(["sales.Orders"]))).toBe(0);
    expect(countVisibleRelations(snapshot, new Set(["sales.Orders", "dbo.Customers"]))).toBe(1);
  });
});
