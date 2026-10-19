import { describe, expect, it } from "vitest";

import { searchPalette } from "./paletteSearch";
import { moduleKey } from "@/features/schema/modules";
import type { ModuleRef } from "@/features/schema/modules";
import { entityKey, qualifiedNameLabel } from "@/features/schema/entities";

import type { PaletteAction, PaletteObject } from "./paletteSearch";

const actions: PaletteAction[] = [
  { id: "project.saveProject", label: "Save project", shortcut: "Ctrl+S", isAvailable: true },
  { id: "project.openProject", label: "Open project", shortcut: "Ctrl+O", isAvailable: true },
  { id: "diagram.export", label: "Export diagram", shortcut: "Ctrl+E", isAvailable: false },
  { id: "help.about", label: "About SchemaCraft", shortcut: "F1", isAvailable: true },
];

const entities: PaletteObject[] = [
  { key: "dbo.Customers", schema: "dbo", name: "Customers", kind: "table" },
  { key: "sales.Orders", schema: "sales", name: "Orders", kind: "table" },
  { key: "sales.OrderLines", schema: "sales", name: "OrderLines", kind: "table" },
  { key: "sales.RecentOrders", schema: "sales", name: "RecentOrders", kind: "view" },
];

describe("searchPalette", () => {
  it("lists every available action when the query is empty", () => {
    const results = searchPalette("", actions, entities);
    expect(
      results.map((result) => (result.kind === "action" ? result.action.id : result.object.key)),
    ).toEqual(["help.about", "project.openProject", "project.saveProject"]);
  });

  it("ranks prefix matches before word starts and substrings, actions before entities", () => {
    const results = searchPalette("ord", actions, entities);
    expect(
      results.map((result) => (result.kind === "action" ? result.action.id : result.object.key)),
    ).toEqual(["sales.Orders", "sales.OrderLines", "sales.RecentOrders"]);

    const mixed = searchPalette("pro", actions, entities);
    expect(
      mixed.map((result) => (result.kind === "action" ? result.action.id : result.object.key)),
    ).toEqual(["project.openProject", "project.saveProject"]);
  });

  it("matches qualified names and ignores unavailable actions", () => {
    const results = searchPalette("sales.rec", actions, entities);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: "object", object: { key: "sales.RecentOrders" } });
    expect(searchPalette("export", actions, entities)).toEqual([]);
  });

  it("finds procedures, functions and triggers by their qualified names", () => {
    const routines = ["procedure", "function", "unknown"].map((kind, index): PaletteObject => {
      const name = { schema: "sales", name: `OrderRoutine${index}` };
      const ref: ModuleRef = { kind: "routine", name };
      return {
        key: moduleKey(ref),
        ref,
        schema: name.schema,
        name: name.name,
        kind: kind as "procedure" | "function" | "unknown",
      };
    });
    const ref: ModuleRef = {
      kind: "trigger",
      parent: { schema: "sales", name: "Orders" },
      name: "OrderAudit",
    };
    const trigger: PaletteObject = {
      key: moduleKey(ref),
      ref,
      schema: "sales",
      name: ref.name,
      kind: "trigger",
    };
    const results = searchPalette("sales.order", [], [...entities, ...routines, trigger]);
    expect(
      results.map((result) => (result.kind === "object" ? result.object.kind : "action")),
    ).toEqual(["table", "trigger", "table", "procedure", "function", "unknown"]);
    expect(searchPalette("OrderAudit", [], [trigger])[0]).toMatchObject({ object: { ref } });
  });

  it("keeps same-name triggers distinct and also finds them by their parent", () => {
    const triggers = ["Orders", "Customers"].map((name): PaletteObject => {
      const ref: ModuleRef = {
        kind: "trigger",
        parent: { schema: "sales", name },
        name: "WriteAudit",
      };
      return { key: moduleKey(ref), ref, schema: "sales", name: ref.name, kind: "trigger" };
    });
    expect(searchPalette("writeaudit", [], triggers)).toHaveLength(2);
    expect(searchPalette("sales.customers", [], triggers)).toEqual([
      { kind: "object", object: triggers[1] },
    ]);
  });

  it("caps object matches across all kinds without limiting actions", () => {
    const objects = Array.from({ length: 20 }, (_, index): PaletteObject => ({
      key: `dbo.Item${index}`,
      schema: "dbo",
      name: `Item${index}`,
      kind: index % 2 === 0 ? "table" : "view",
    }));
    expect(searchPalette("item", [], objects)).toHaveLength(12);
    expect(searchPalette("", actions, objects).every((result) => result.kind === "action")).toBe(
      true,
    );
  });

  it("finds dotted objects and trigger parents by their exact displayed names", () => {
    const names = [
      { schema: "a.b", name: "Orders" },
      { schema: "a", name: "b.Orders" },
    ];
    const objects = names.map((name): PaletteObject => ({
      ...name,
      key: entityKey(name),
      kind: "table",
    }));
    const triggers = names.map((parent): PaletteObject => {
      const ref: ModuleRef = { kind: "trigger", parent, name: "WriteAudit" };
      return { key: moduleKey(ref), ref, schema: parent.schema, name: ref.name, kind: "trigger" };
    });
    for (const [index, name] of names.entries()) {
      const query = ` ${qualifiedNameLabel(name).toUpperCase()} `;
      expect(searchPalette(query, [], objects)).toEqual([
        { kind: "object", object: objects[index] },
      ]);
      expect(searchPalette(query, [], triggers)).toEqual([
        { kind: "object", object: triggers[index] },
      ]);
    }
    expect(searchPalette("a.b.Orders", [], objects)).toHaveLength(2);
    expect(searchPalette("a.b.Orders", [], triggers)).toHaveLength(2);
  });
});
