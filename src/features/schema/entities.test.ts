import { describe, expect, it } from "vitest";

import type { SchemaSnapshot } from "@/shared/contracts";

import { countEntities, filterEntityGroups, groupEntitiesBySchema } from "./entities";

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

describe("groupEntitiesBySchema", () => {
  it("sorts schemas and entities, listing views after tables", () => {
    const groups = groupEntitiesBySchema(snapshot);
    expect(groups.map((group) => group.schema)).toEqual(["dbo", "sales"]);
    expect(groups[1]?.entities.map((entity) => `${entity.kind}:${entity.name}`)).toEqual([
      "table:Carts",
      "table:Orders",
      "view:ActiveOrders",
    ]);
    expect(groups[0]?.entities[0]).toMatchObject({ key: "dbo.Customers", columnCount: 6 });
  });
});

describe("filterEntityGroups", () => {
  it("matches on schema or name, case-insensitively, and drops empty groups", () => {
    const groups = groupEntitiesBySchema(snapshot);
    expect(filterEntityGroups(groups, "ORD").map((group) => group.schema)).toEqual(["sales"]);
    expect(countEntities(filterEntityGroups(groups, "ord"))).toBe(2);
    expect(countEntities(filterEntityGroups(groups, "dbo."))).toBe(1);
    expect(filterEntityGroups(groups, "nothing")).toEqual([]);
    expect(filterEntityGroups(groups, "  ")).toBe(groups);
  });
});
