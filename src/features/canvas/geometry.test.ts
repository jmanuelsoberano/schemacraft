import { describe, expect, it } from "vitest";

import type { Column, SchemaSnapshot, Trigger } from "@/shared/contracts";

import {
  HEADER_HEIGHT,
  ROW_HEIGHT,
  attachmentY,
  describeEntities,
  effectiveDetailLevel,
  isCollapsible,
  nodeHeight,
  relationOffsets,
  rowsFor,
  triggerBadge,
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

function trigger(name: string, overrides: Partial<Trigger> = {}): Trigger {
  return {
    parent: { schema: "sales", name: "Orders" },
    name,
    timing: "after",
    events: [{ event: "insert", order: "unspecified" }],
    isEnabled: true,
    isNotForReplication: false,
    body: { language: "sql", definition: { status: "notVisible" } },
    ...overrides,
  };
}

function withTriggers(triggers: Trigger[]): SchemaSnapshot {
  return {
    ...snapshot,
    programmability: {
      capture: {
        objects: { status: "read" },
        definitions: { status: "notRead", reason: "optionOff" },
      },
      routines: [],
      views: [],
      triggers,
    },
  };
}

describe("triggerBadge", () => {
  const parent = { schema: "sales", name: "Orders" };
  it("counts enabled AFTER triggers without requiring their code", () => {
    expect(triggerBadge(withTriggers([trigger("A"), trigger("B")]), parent)).toEqual({
      enabled: 2,
      disabled: 0,
      insteadOf: 0,
      disabledInsteadOf: 0,
      count: 2,
      allDisabled: false,
    });
  });
  it("counts only enabled INSTEAD OF triggers in a mixed badge", () => {
    const capture = withTriggers([
      trigger("A"),
      trigger("B", { timing: "insteadOf" }),
      trigger("C", { isEnabled: false, timing: "insteadOf" }),
      trigger("Other", { parent: { schema: "dbo", name: "Customers" } }),
    ]);
    expect(triggerBadge(capture, parent)).toEqual({
      enabled: 2,
      disabled: 1,
      insteadOf: 1,
      disabledInsteadOf: 1,
      count: 2,
      allDisabled: false,
    });
  });
  it("uses the disabled total when every trigger is disabled", () => {
    expect(
      triggerBadge(
        withTriggers([
          trigger("A", { isEnabled: false }),
          trigger("B", { isEnabled: false, timing: "insteadOf" }),
        ]),
        parent,
      ),
    ).toEqual({
      enabled: 0,
      disabled: 2,
      insteadOf: 0,
      disabledInsteadOf: 1,
      count: 2,
      allDisabled: true,
    });
  });
  it("omits absent, unread and unverified lists without mistaking definition retention for metadata", () => {
    expect(triggerBadge(snapshot, parent)).toBeNull();
    expect(triggerBadge(withTriggers([]), parent)).toBeNull();
    const capture = withTriggers([trigger("A")]);
    const code = capture.programmability;
    if (code === undefined) throw new Error("code fixture missing");
    expect(
      triggerBadge(
        {
          ...capture,
          programmability: {
            ...code,
            capture: {
              ...code.capture,
              objects: { status: "notRead", reason: "queryFailed" },
            },
          },
        },
        parent,
      ),
    ).toBeNull();
    expect(
      triggerBadge(
        {
          ...capture,
          carriedOver: [
            { object: parent, fact: { kind: "table" }, readAt: "2026-10-12T00:00:00Z" },
          ],
        },
        parent,
      ),
    ).toBeNull();
    for (const part of ["whole", "definition"] as const) {
      const badge = triggerBadge(
        {
          ...capture,
          programmability: {
            ...code,
            carriedOver: [
              {
                object: { kind: "trigger", parent, name: "A" },
                part,
                readAt: "2026-10-12T00:00:00Z",
              },
            ],
          },
        },
        parent,
      );
      if (part === "whole") expect(badge).toBeNull();
      else expect(badge?.count).toBe(1);
    }
  });
  it("adds the same descriptor to tables and views without changing any node height", () => {
    const view = { schema: "sales", name: "RecentOrders" };
    const before = describeEntities(snapshot);
    const after = describeEntities(
      withTriggers([trigger("A"), trigger("V", { parent: view, timing: "insteadOf" })]),
    );
    for (const key of ["sales.Orders", "sales.RecentOrders"]) {
      const original = before.get(key);
      const decorated = after.get(key);
      if (original === undefined || decorated === undefined)
        throw new Error("entity fixture missing");
      expect(decorated.triggers?.count).toBe(1);
      for (const detail of ["compact", "keys", "full"] as const) {
        expect(nodeHeight(rowsFor(decorated, detail, false).length)).toBe(
          nodeHeight(rowsFor(original, detail, false).length),
        );
      }
    }
  });
});

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

  it("attaches a relationship at the first column pair of each end", () => {
    const customers = entities.get("dbo.Customers");
    const foreignKey = snapshot.foreignKeys[0];
    if (customers === undefined || foreignKey === undefined) {
      throw new Error("fixture expected");
    }
    const orderRows = rowsFor(orders, "keys", false);
    const customerRows = rowsFor(customers, "keys", false);
    expect(relationOffsets(foreignKey, orderRows, customerRows)).toEqual([
      attachmentY(orderRows, "CustomerId"),
      attachmentY(customerRows, "CustomerId"),
    ]);
    // Collapsed or compact ends attach at the middle of the header.
    expect(relationOffsets(foreignKey, [], [])).toEqual([HEADER_HEIGHT / 2, HEADER_HEIGHT / 2]);
  });

  it("falls back to compact nodes when zoomed out", () => {
    expect(effectiveDetailLevel("full", 0.3)).toBe("compact");
    expect(effectiveDetailLevel("full", 0.4)).toBe("full");
    expect(effectiveDetailLevel("keys", 1)).toBe("keys");
  });
});

describe("isCollapsible", () => {
  const entities = describeEntities(snapshot);
  const orders = entities.get("sales.Orders");
  const recentOrders = entities.get("sales.RecentOrders");
  const foreignKey = snapshot.foreignKeys[0];
  if (orders === undefined || recentOrders === undefined || foreignKey === undefined) {
    throw new Error("fixture expected");
  }

  it("draws a view at the keys level as a header-only card of the usual height", () => {
    const rows = rowsFor(recentOrders, "keys", false);
    expect(rows).toEqual([]);
    expect(nodeHeight(rows.length)).toBe(HEADER_HEIGHT);
    // With no rows, a relationship meets the card at the middle of its header.
    expect(relationOffsets(foreignKey, rows, rows)).toEqual([HEADER_HEIGHT / 2, HEADER_HEIGHT / 2]);
    expect(rowsFor(recentOrders, "full", false)).toHaveLength(1);
  });

  it("offers the collapse toggle only where there are rows to hide", () => {
    expect(isCollapsible(recentOrders, "keys")).toBe(false);
    expect(isCollapsible(recentOrders, "full")).toBe(true);
    expect(isCollapsible(orders, "keys")).toBe(true);
    expect(isCollapsible(orders, "full")).toBe(true);
    // Nothing folds at compact, nor a table without keys at the keys level.
    expect(isCollapsible(orders, "compact")).toBe(false);
    expect(isCollapsible(recentOrders, "compact")).toBe(false);
    const keyless = {
      ...orders,
      primaryKeyColumns: new Set<string>(),
      foreignKeyColumns: new Set<string>(),
    };
    expect(isCollapsible(keyless, "keys")).toBe(false);
    expect(isCollapsible(keyless, "full")).toBe(true);
  });
});
