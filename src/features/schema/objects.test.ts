import { assert, describe, expect, it } from "vitest";

import type { Routine, SchemaSnapshot } from "@/shared/contracts";

import {
  countObjects,
  groupObjects,
  listObjects,
  objectListShape,
  objectPage,
  searchObjectGroups,
} from "./objects";

function routine(schema: string, name: string, kind: Routine["kind"] = "procedure"): Routine {
  return {
    name: { schema, name },
    kind,
    body: { language: "sql", definition: { status: "notVisible" } },
    parameters: [],
    columns: [],
    returns: null,
  };
}

const snapshot: SchemaSnapshot = {
  databaseName: "Shop",
  serverVersion: null,
  extractedAt: "2026-10-19T12:00:00Z",
  tables: [
    {
      name: { schema: "sales", name: "Orders" },
      columns: [],
      primaryKey: null,
      indexes: [],
      checkConstraints: [],
    },
  ],
  views: [{ name: { schema: "sales", name: "RecentOrders" }, columns: [] }],
  foreignKeys: [],
  programmability: {
    capture: { objects: { status: "read" }, definitions: { status: "read" } },
    views: [],
    routines: [
      routine("sales", "ZOrders"),
      routine("sales", "AddOrder"),
      routine("sales", "Total", "scalarFunction"),
      routine("reporting", "Rows", "inlineTableFunction"),
      routine("sales", "Future", "unknown"),
    ],
    triggers: [
      {
        parent: { schema: "sales", name: "Orders" },
        name: "OrdersAudit",
        timing: "after",
        events: [],
        isEnabled: true,
        isNotForReplication: false,
        body: { language: "clr" },
      },
    ],
  },
};

describe("object lists", () => {
  it("groups tables, views, procedures and functions by schema, keeping triggers with their parent details", () => {
    const groups = groupObjects(listObjects(snapshot));
    expect(groups.map((group) => group.schema)).toEqual(["reporting", "sales"]);
    expect(groups[1]?.sections.map((section) => section.kind)).toEqual([
      "table",
      "view",
      "procedure",
      "function",
      "unknown",
    ]);
    expect(groups[1]?.sections[2]?.objects.map((item) => item.name)).toEqual([
      "AddOrder",
      "ZOrders",
    ]);
    expect(countObjects(groups)).toBe(7);
    expect(listObjects(snapshot).some((item) => item.name === "OrdersAudit")).toBe(false);
  });

  it("retains the table/view grouping rules and always names a routine section", () => {
    assert(snapshot.programmability);
    const tableOnly = { ...snapshot, views: [], programmability: undefined };
    expect(objectListShape(groupObjects(listObjects(tableOnly)))).toEqual({
      showsSchemas: false,
      showsKinds: false,
    });
    expect(
      objectListShape(groupObjects(listObjects({ ...snapshot, programmability: undefined }))),
    ).toEqual({ showsSchemas: false, showsKinds: true });
    const codeOnly = {
      ...snapshot,
      tables: [],
      views: [],
      programmability: {
        ...snapshot.programmability,
        routines: [routine("sales", "OnlyProcedure")],
      },
    };
    expect(objectListShape(groupObjects(listObjects(codeOnly)))).toEqual({
      showsSchemas: false,
      showsKinds: true,
    });
  });

  it("reveals 200 more rows without moving or discarding the earlier rows", () => {
    assert(snapshot.programmability);
    const objects = listObjects({
      ...snapshot,
      tables: [],
      views: [],
      programmability: {
        ...snapshot.programmability,
        routines: Array.from({ length: 601 }, (_, index) => routine("bulk", `Proc${index}`)),
      },
    });
    const first = objectPage(objects, 1);
    const second = objectPage(objects, 2);
    expect(first).toHaveLength(200);
    expect(second).toHaveLength(400);
    expect(second.slice(0, first.length)).toEqual(first);
    expect(second[first.length]?.name).toBe("Proc200");
    expect(objectPage(objects, 4)).toHaveLength(601);
  });

  it("searches qualified names across kinds without changing the unfiltered list shape", () => {
    const groups = groupObjects(listObjects(snapshot));
    const before = objectListShape(groups);
    const result = searchObjectGroups(groups, "  SALES.ADD  ");
    expect(result.groups[0]?.sections[0]?.objects[0]?.name).toBe("AddOrder");
    expect(result.totalMatches).toBe(1);
    expect(result.isLimited).toBe(false);
    expect(objectListShape(groups)).toEqual(before);
    expect(searchObjectGroups(groups, "orders").totalMatches).toBe(3);
    expect(searchObjectGroups(groups, "").groups).toBe(groups);
    expect(searchObjectGroups(groups, "unmatched").groups).toEqual([]);
  });

  it("caps search globally rather than rendering 200 matches for every schema and kind", () => {
    assert(snapshot.programmability);
    const many = {
      ...snapshot,
      tables: [],
      views: [],
      programmability: {
        ...snapshot.programmability,
        routines: [
          ...Array.from({ length: 150 }, (_, index) => routine("a", `Match${index}`)),
          ...Array.from({ length: 150 }, (_, index) =>
            routine("a", `MatchFn${index}`, "scalarFunction"),
          ),
          ...Array.from({ length: 150 }, (_, index) => routine("b", `Match${index}`)),
        ],
      },
    };
    const result = searchObjectGroups(groupObjects(listObjects(many)), "match");
    expect(result.totalMatches).toBe(450);
    expect(result.isLimited).toBe(true);
    expect(countObjects(result.groups)).toBe(200);
    expect(result.groups.map((group) => group.schema)).toEqual(["a"]);
    expect(result.groups[0]?.sections.map((section) => section.objects.length)).toEqual([150, 50]);
  });
});
