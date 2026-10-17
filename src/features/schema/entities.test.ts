import { describe, expect, it } from "vitest";

import type { SchemaSnapshot } from "@/shared/contracts";

import {
  countEntities,
  entityKey,
  entityListShape,
  filterEntityGroups,
  groupEntities,
  listEntities,
} from "./entities";

function table(
  schema: string,
  name: string,
  columnCount: number,
): SchemaSnapshot["tables"][number] {
  return {
    name: { schema, name },
    columns: Array.from({ length: columnCount }, (_, index) => ({
      name: `Column${index}`,
      ordinalPosition: index + 1,
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
    })),
    primaryKey: null,
    indexes: [],
    checkConstraints: [],
  };
}

const snapshot: SchemaSnapshot = {
  databaseName: "Northwind",
  serverVersion: null,
  extractedAt: "2026-10-13T12:00:00Z",
  tables: [table("sales", "Orders", 4), table("dbo", "Customers", 6), table("sales", "Carts", 2)],
  views: [{ name: { schema: "sales", name: "ActiveOrders" }, columns: [] }],
  foreignKeys: [],
};

/** `kind:schema.name` of every entity, in list order. */
function flatten(groups: ReturnType<typeof groupEntities>): string[] {
  return groups.flatMap((group) =>
    group.sections.flatMap((section) =>
      section.entities.map((entity) => `${section.kind}:${entity.key}`),
    ),
  );
}

describe("entityKey", () => {
  it("joins schema and name with a dot", () => {
    expect(entityKey({ schema: "a", name: "b" })).toBe("a.b");
  });
});

describe("listEntities", () => {
  it("lists tables in snapshot order, then views", () => {
    expect(listEntities(snapshot).map((entity) => `${entity.kind}:${entity.key}`)).toEqual([
      "table:sales.Orders",
      "table:dbo.Customers",
      "table:sales.Carts",
      "view:sales.ActiveOrders",
    ]);
    expect(listEntities(snapshot)[1]).toEqual({
      key: "dbo.Customers",
      schema: "dbo",
      name: "Customers",
      kind: "table",
      columnCount: 6,
    });
  });
});

describe("groupEntities", () => {
  it("sorts schemas, puts the Tables section before Views and names alphabetically", () => {
    const groups = groupEntities(listEntities(snapshot));
    expect(groups.map((group) => group.schema)).toEqual(["dbo", "sales"]);
    expect(groups[1]?.sections.map((section) => section.kind)).toEqual(["table", "view"]);
    expect(flatten(groups)).toEqual([
      "table:dbo.Customers",
      "table:sales.Carts",
      "table:sales.Orders",
      "view:sales.ActiveOrders",
    ]);
  });

  it("gives a schema with only tables a single section", () => {
    const groups = groupEntities(listEntities(snapshot));
    expect(groups[0]?.sections.map((section) => section.kind)).toEqual(["table"]);
  });

  it("gives a schema with only views a single Views section", () => {
    const groups = groupEntities(
      listEntities({
        ...snapshot,
        views: [...snapshot.views, { name: { schema: "reporting", name: "Totals" }, columns: [] }],
      }),
    );
    expect(groups.map((group) => group.schema)).toEqual(["dbo", "reporting", "sales"]);
    expect(groups[1]?.sections.map((section) => section.kind)).toEqual(["view"]);
    expect(flatten(groups.slice(1, 2))).toEqual(["view:reporting.Totals"]);
  });

  it("returns no groups for an empty snapshot", () => {
    expect(groupEntities([])).toEqual([]);
  });
});

describe("filterEntityGroups", () => {
  const groups = groupEntities(listEntities(snapshot));

  it("matches on schema or name, case-insensitively, and drops empty sections and groups", () => {
    expect(filterEntityGroups(groups, "ORD").map((group) => group.schema)).toEqual(["sales"]);
    expect(flatten([...filterEntityGroups(groups, "ord")])).toEqual([
      "table:sales.Orders",
      "view:sales.ActiveOrders",
    ]);
    expect(flatten([...filterEntityGroups(groups, "carts")])).toEqual(["table:sales.Carts"]);
    expect(filterEntityGroups(groups, "nothing")).toEqual([]);
    expect(filterEntityGroups(groups, "  ")).toBe(groups);
  });

  it("matches a schema prefix", () => {
    expect(countEntities(filterEntityGroups(groups, "dbo."))).toBe(1);
    expect(countEntities(filterEntityGroups(groups, "sales."))).toBe(3);
  });
});

describe("countEntities", () => {
  it("counts across every section", () => {
    expect(countEntities(groupEntities(listEntities(snapshot)))).toBe(4);
    expect(countEntities([])).toBe(0);
  });
});

describe("entityListShape", () => {
  it("shows a level only when it tells entities apart", () => {
    expect(entityListShape(groupEntities(listEntities(snapshot)))).toEqual({
      showsSchemas: true,
      showsKinds: true,
    });
    const oneSchemaBothKinds = groupEntities(
      listEntities({ ...snapshot, tables: [table("sales", "Orders", 1)] }),
    );
    expect(entityListShape(oneSchemaBothKinds)).toEqual({ showsSchemas: false, showsKinds: true });
    const twoSchemasOneKind = groupEntities(listEntities({ ...snapshot, views: [] }));
    expect(entityListShape(twoSchemasOneKind)).toEqual({ showsSchemas: true, showsKinds: false });
    // Views alone are one kind too: no Tables header appears just because tables are absent.
    const viewsOnly = groupEntities(listEntities({ ...snapshot, tables: [] }));
    expect(entityListShape(viewsOnly)).toEqual({ showsSchemas: false, showsKinds: false });
    expect(entityListShape([])).toEqual({ showsSchemas: false, showsKinds: false });
  });

  it("is decided on the unfiltered groups, so a search never changes the shape", () => {
    const groups = groupEntities(listEntities(snapshot));
    const shape = entityListShape(groups);
    const narrowed = filterEntityGroups(groups, "carts");
    expect(narrowed.map((group) => group.schema)).toEqual(["sales"]);
    expect(entityListShape(narrowed)).toEqual({ showsSchemas: false, showsKinds: false });
    expect(shape).toEqual({ showsSchemas: true, showsKinds: true });
  });
});
