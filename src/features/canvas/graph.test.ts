import { describe, expect, it } from "vitest";

import { entityKey } from "@/features/schema/entities";
import { foreignKeyExplanation } from "@/features/schema/rules/foreignKeyReader";
import type {
  Column,
  ForeignKey,
  Index,
  NodeState,
  QualifiedName,
  SchemaSnapshot,
  Table,
} from "@/shared/contracts";

import { endMarkerKind, startMarkerKind } from "./edgeGeometry";
import { describeEntities } from "./geometry";
import {
  buildEntityNodes,
  buildRelationEdges,
  countVisibleRelations,
  relationEnds,
  tablesByKey,
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

  it("connects visible ends only and marks an optional key at the referenced end", () => {
    const nodes = buildEntityNodes(entities, states, "keys");
    const edges = buildRelationEdges(snapshot, nodes);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.id).toBe("sales.Orders.FK_Orders_Customers");
    expect(edges[0]?.source).toBe("sales.Orders");
    expect(edges[0]?.target).toBe("dbo.Customers");
    expect(edges[0]?.data?.ends).toEqual({ start: "many", end: "zeroOrOne" });

    const partial = buildEntityNodes(
      entities,
      states.map((state, index) => (index === 0 ? { ...state, isHidden: true } : state)),
      "keys",
    );
    expect(buildRelationEdges(snapshot, partial)).toEqual([]);
    expect(countVisibleRelations(snapshot, new Set(["sales.Orders"]))).toBe(0);
    expect(countVisibleRelations(snapshot, new Set(["sales.Orders", "dbo.Customers"]))).toBe(1);
  });

  it("carries each key's words, worked out once for the snapshot, for its hover label", () => {
    const [key] = snapshot.foreignKeys;
    if (key === undefined) {
      throw new Error("no key");
    }
    const first = buildRelationEdges(snapshot, buildEntityNodes(entities, states, "keys"));
    // A drag or a detail level builds the edges again from the same snapshot, words and all.
    const again = buildRelationEdges(snapshot, buildEntityNodes(entities, states, "full"));
    expect(first[0]?.data?.explanation).toBe(foreignKeyExplanation(snapshot, key));
    expect(again[0]?.data?.explanation).toBe(first[0]?.data?.explanation);
  });
});

describe("relationEnds", () => {
  function table(
    schema: string,
    name: string,
    columns: Column[],
    primaryKey: string[],
    indexes: Table["indexes"] = [],
  ): Table {
    return {
      name: { schema, name },
      columns,
      primaryKey: { name: `PK_${name}`, columns: primaryKey, isClustered: true },
      indexes,
      checkConstraints: [],
    };
  }

  function key(
    name: string,
    referencing: QualifiedName,
    referenced: QualifiedName,
    pairs: [string, string][],
  ): ForeignKey {
    return {
      name,
      referencingTable: referencing,
      referencedTable: referenced,
      columnPairs: pairs.map(([referencingColumn, referencedColumn]) => ({
        referencingColumn,
        referencedColumn,
      })),
      onDelete: "noAction",
      onUpdate: "noAction",
      isEnabled: true,
    };
  }

  const orders = { schema: "sales", name: "Orders" };
  const lines = { schema: "sales", name: "OrderLines" };
  const employees = { schema: "hr", name: "Employees" };
  const unique = (kind: "uniqueConstraint" | "uniqueIndex") => [
    { name: `UX_${kind}`, columns: ["OrderId"], kind, isClustered: false },
  ];
  const shop: SchemaSnapshot = {
    ...snapshot,
    tables: [
      table("sales", "Orders", [column("OrderId"), column("SalesRepId", true)], ["OrderId"]),
      table(
        "sales",
        "OrderLines",
        [column("OrderId"), column("LineNumber")],
        ["OrderId", "LineNumber"],
      ),
      table(
        "sales",
        "Shipments",
        [column("ShipmentId"), column("OrderId"), column("LineNumber", true)],
        ["ShipmentId"],
      ),
      table("sales", "OrderNotes", [column("OrderId")], ["OrderId"]),
      table(
        "sales",
        "Invoices",
        [column("InvoiceId"), column("OrderId")],
        ["InvoiceId"],
        unique("uniqueConstraint"),
      ),
      table(
        "sales",
        "Refunds",
        [column("RefundId"), column("OrderId", true)],
        ["RefundId"],
        unique("uniqueIndex"),
      ),
      table("hr", "Employees", [column("EmployeeId"), column("ManagerId", true)], ["EmployeeId"]),
    ],
    views: [],
    foreignKeys: [
      key("FK_OrderLines_Orders", lines, orders, [["OrderId", "OrderId"]]),
      // One of two columns accepts NULL: SQL Server does not check such a row, so it may
      // point nowhere.
      key("FK_Shipments_OrderLines", { schema: "sales", name: "Shipments" }, lines, [
        ["OrderId", "OrderId"],
        ["LineNumber", "LineNumber"],
      ]),
      key("FK_OrderNotes_Orders", { schema: "sales", name: "OrderNotes" }, orders, [
        ["OrderId", "OrderId"],
      ]),
      key("FK_Invoices_Orders", { schema: "sales", name: "Invoices" }, orders, [
        ["OrderId", "OrderId"],
      ]),
      key("FK_Refunds_Orders", { schema: "sales", name: "Refunds" }, orders, [
        ["OrderId", "OrderId"],
      ]),
      key("FK_Employees_Manager", employees, employees, [["ManagerId", "EmployeeId"]]),
    ],
  };
  const tables = tablesByKey(shop);
  const endsOf = (foreignKey: ForeignKey) =>
    relationEnds(tables.get(entityKey(foreignKey.referencingTable)), foreignKey);

  it("puts zero or one at the referenced end when any key column accepts NULL", () => {
    expect(
      shop.foreignKeys.map((foreignKey) => `${foreignKey.name}:${endsOf(foreignKey).end}`),
    ).toEqual([
      "FK_OrderLines_Orders:one",
      "FK_Shipments_OrderLines:zeroOrOne",
      "FK_OrderNotes_Orders:one",
      "FK_Invoices_Orders:one",
      "FK_Refunds_Orders:zeroOrOne",
      "FK_Employees_Manager:zeroOrOne",
    ]);
  });

  it("puts zero or one at the referencing end of a one-to-one key and a crow's foot otherwise", () => {
    expect(
      shop.foreignKeys.map((foreignKey) => `${foreignKey.name}:${endsOf(foreignKey).start}`),
    ).toEqual([
      "FK_OrderLines_Orders:many",
      "FK_Shipments_OrderLines:many",
      // The primary key and a unique constraint make the key one-to-one.
      "FK_OrderNotes_Orders:zeroOrOne",
      "FK_Invoices_Orders:zeroOrOne",
      // A unique index may be filtered, so it allows several rows: the crow's foot stays.
      "FK_Refunds_Orders:many",
      "FK_Employees_Manager:many",
    ]);
  });

  it("draws what the key's sentences say, on every edge", () => {
    const nodes = buildEntityNodes(describeEntities(shop), [], "keys");
    const edges = buildRelationEdges(shop, nodes);
    expect(edges).toHaveLength(shop.foreignKeys.length);
    for (const edge of edges) {
      const foreignKey = edge.data?.foreignKey;
      expect(foreignKey).toBeDefined();
      if (foreignKey === undefined) {
        continue;
      }
      const explanation = foreignKeyExplanation(shop, foreignKey);
      expect(edge.data?.ends).toEqual({
        start: startMarkerKind(explanation.childCardinality ?? "unknown"),
        end: endMarkerKind(explanation.optionality),
      });
    }
  });

  it("follows the state of the unique index behind the key, as a refresh records it", () => {
    const keyNamed = (name: string): ForeignKey => {
      const found = shop.foreignKeys.find((candidate) => candidate.name === name);
      if (found === undefined) {
        throw new Error("the fixture changed");
      }
      return found;
    };
    /** The referencing table of `foreignKey` with one unique index of `kind` on its key column. */
    const startWith = (
      foreignKey: ForeignKey,
      kind: "uniqueConstraint" | "uniqueIndex",
      state: Pick<Index, "includedColumns" | "isFiltered" | "isEnabled">,
    ) =>
      relationEnds(
        table(
          foreignKey.referencingTable.schema,
          foreignKey.referencingTable.name,
          [column("Id"), column("OrderId", true)],
          ["Id"],
          [{ name: "UX_Order", columns: ["OrderId"], kind, isClustered: false, ...state }],
        ),
        foreignKey,
      ).start;
    const refunds = keyNamed("FK_Refunds_Orders");
    const invoices = keyNamed("FK_Invoices_Orders");

    // An enabled unique index without a filter makes the key one-to-one, which 1.1 left as a
    // crow's foot; a filtered or disabled one, or one whose state was not recorded, does not.
    expect(startWith(refunds, "uniqueIndex", { isEnabled: true, isFiltered: false })).toBe(
      "zeroOrOne",
    );
    expect(startWith(refunds, "uniqueIndex", { isEnabled: true, isFiltered: true })).toBe("many");
    expect(startWith(refunds, "uniqueIndex", { isEnabled: false, isFiltered: false })).toBe("many");
    expect(startWith(refunds, "uniqueIndex", {})).toBe("many");
    // A unique constraint whose index is disabled limits nothing; one whose state was not
    // recorded keeps the 1.1 reading.
    expect(startWith(invoices, "uniqueConstraint", { isEnabled: false })).toBe("many");
    expect(startWith(invoices, "uniqueConstraint", { isEnabled: true })).toBe("zeroOrOne");
    expect(startWith(invoices, "uniqueConstraint", {})).toBe("zeroOrOne");

    // A disabled clustered primary key takes no row, and SQL Server keeps the key disabled until
    // it is rebuilt, unique again; a disabled nonclustered one limits nothing.
    const keyedByOrder = (isClustered: boolean) =>
      relationEnds(
        {
          ...table(
            refunds.referencingTable.schema,
            refunds.referencingTable.name,
            [column("OrderId")],
            ["OrderId"],
          ),
          primaryKey: { name: "PK_Refunds", columns: ["OrderId"], isClustered, isEnabled: false },
        },
        refunds,
      ).start;
    expect(keyedByOrder(true)).toBe("zeroOrOne");
    expect(keyedByOrder(false)).toBe("many");
  });

  it("keeps the plain ends when the referencing table is not known", () => {
    const [first] = shop.foreignKeys;
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(relationEnds(undefined, first)).toEqual({ start: "many", end: "one" });
    }
  });
});
