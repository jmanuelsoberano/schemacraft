import { describe, expect, it } from "vitest";

import type { Column, SchemaSnapshot } from "@/shared/contracts";

import {
  HEADER_HEIGHT,
  ROW_HEIGHT,
  attachmentY,
  describeEntities,
  effectiveDetailLevel,
  entityKey,
  nodeHeight,
  rowsFor,
} from "./geometry";

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
      columns: [column("CustomerId"), column("Name"), column("Notes", true)],
      primaryKey: { name: "PK_Customers", columns: ["CustomerId"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
    {
      name: { schema: "sales", name: "Orders" },
      columns: [column("OrderId"), column("CustomerId"), column("PlacedAt"), column("Total")],
      primaryKey: { name: "PK_Orders", columns: ["OrderId"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
    {
      name: { schema: "dbo", name: "CustomerTags" },
      columns: [column("CustomerId"), column("TagId")],
      primaryKey: { name: "PK_CustomerTags", columns: ["CustomerId", "TagId"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
  ],
  views: [{ name: { schema: "sales", name: "RecentOrders" }, columns: [column("OrderId")] }],
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
    {
      name: "FK_CustomerTags_Customers",
      referencingTable: { schema: "dbo", name: "CustomerTags" },
      referencedTable: { schema: "dbo", name: "Customers" },
      columnPairs: [{ referencingColumn: "CustomerId", referencedColumn: "CustomerId" }],
      onDelete: "cascade",
      onUpdate: "noAction",
      isEnabled: true,
    },
  ],
};

describe("describeEntities", () => {
  it("classifies key columns per entity", () => {
    const entities = describeEntities(snapshot);
    expect([...entities.keys()]).toEqual([
      "dbo.Customers",
      "sales.Orders",
      "dbo.CustomerTags",
      "sales.RecentOrders",
    ]);
    const orders = entities.get("sales.Orders");
    expect(orders?.kind).toBe("table");
    expect([...(orders?.primaryKeyColumns ?? [])]).toEqual(["OrderId"]);
    expect([...(orders?.foreignKeyColumns ?? [])]).toEqual(["CustomerId"]);
    expect(entities.get("sales.RecentOrders")?.kind).toBe("view");
    expect(entityKey({ schema: "a", name: "b" })).toBe("a.b");
  });

  it("keeps the badge of a key to a table the login cannot see", () => {
    const entities = describeEntities({
      ...snapshot,
      foreignKeysToInvisibleTables: [
        {
          name: "FK_Orders_Regions",
          referencingTable: { schema: "sales", name: "Orders" },
          columns: ["PlacedAt"],
          onDelete: "noAction",
          onUpdate: "noAction",
          isEnabled: true,
        },
      ],
    });
    const orders = entities.get("sales.Orders");
    if (orders === undefined) {
      throw new Error("fixture entity expected");
    }

    expect([...orders.foreignKeyColumns]).toEqual(["CustomerId", "PlacedAt"]);
    expect(rowsFor(orders, "keys", false).map((row) => `${row.column.name}:${row.role}`)).toEqual([
      "OrderId:primary",
      "CustomerId:foreign",
      "PlacedAt:foreign",
    ]);
  });
});

describe("rowsFor", () => {
  const entities = describeEntities(snapshot);
  const tags = entities.get("dbo.CustomerTags");
  const orders = entities.get("sales.Orders");
  if (tags === undefined || orders === undefined) {
    throw new Error("fixture entities expected");
  }

  it("shows nothing when compact or collapsed, keys only at the keys level, everything at full", () => {
    expect(rowsFor(orders, "compact", false)).toEqual([]);
    expect(rowsFor(orders, "full", true)).toEqual([]);
    expect(rowsFor(orders, "keys", false).map((row) => `${row.column.name}:${row.role}`)).toEqual([
      "OrderId:primary",
      "CustomerId:foreign",
    ]);
    expect(rowsFor(orders, "full", false)).toHaveLength(4);
    expect(rowsFor(tags, "keys", false).map((row) => row.role)).toEqual(["both", "primary"]);
  });

  it("measures nodes and locates relationship attachment points", () => {
    expect(nodeHeight(0)).toBe(HEADER_HEIGHT);
    expect(nodeHeight(2)).toBe(HEADER_HEIGHT + 2 * ROW_HEIGHT + 6);
    const rows = rowsFor(orders, "keys", false);
    expect(attachmentY(rows, "CustomerId")).toBe(HEADER_HEIGHT + ROW_HEIGHT + ROW_HEIGHT / 2);
    expect(attachmentY(rows, "Total")).toBe(HEADER_HEIGHT / 2);
    expect(attachmentY([], "OrderId")).toBe(HEADER_HEIGHT / 2);
  });

  it("falls back to compact nodes when zoomed out", () => {
    expect(effectiveDetailLevel("full", 0.3)).toBe("compact");
    expect(effectiveDetailLevel("full", 0.4)).toBe("full");
    expect(effectiveDetailLevel("keys", 1)).toBe("keys");
  });
});
