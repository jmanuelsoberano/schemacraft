import { describe, expect, it } from "vitest";

import { searchPalette } from "./paletteSearch";
import type { PaletteAction, PaletteEntity } from "./paletteSearch";

const actions: PaletteAction[] = [
  { id: "project.saveProject", label: "Save project", shortcut: "Ctrl+S", isAvailable: true },
  { id: "project.openProject", label: "Open project", shortcut: "Ctrl+O", isAvailable: true },
  { id: "diagram.export", label: "Export diagram", shortcut: "Ctrl+E", isAvailable: false },
  { id: "help.about", label: "About SchemaCraft", shortcut: "F1", isAvailable: true },
];

const entities: PaletteEntity[] = [
  { key: "dbo.Customers", schema: "dbo", name: "Customers", kind: "table" },
  { key: "sales.Orders", schema: "sales", name: "Orders", kind: "table" },
  { key: "sales.OrderLines", schema: "sales", name: "OrderLines", kind: "table" },
  { key: "sales.RecentOrders", schema: "sales", name: "RecentOrders", kind: "view" },
];

describe("searchPalette", () => {
  it("lists every available action when the query is empty", () => {
    const results = searchPalette("", actions, entities);
    expect(
      results.map((result) => (result.kind === "action" ? result.action.id : result.entity.key)),
    ).toEqual(["help.about", "project.openProject", "project.saveProject"]);
  });

  it("ranks prefix matches before word starts and substrings, actions before entities", () => {
    const results = searchPalette("ord", actions, entities);
    expect(
      results.map((result) => (result.kind === "action" ? result.action.id : result.entity.key)),
    ).toEqual(["sales.Orders", "sales.OrderLines", "sales.RecentOrders"]);

    const mixed = searchPalette("pro", actions, entities);
    expect(
      mixed.map((result) => (result.kind === "action" ? result.action.id : result.entity.key)),
    ).toEqual(["project.openProject", "project.saveProject"]);
  });

  it("matches qualified names and ignores unavailable actions", () => {
    const results = searchPalette("sales.rec", actions, entities);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: "entity", entity: { key: "sales.RecentOrders" } });
    expect(searchPalette("export", actions, entities)).toEqual([]);
  });
});
