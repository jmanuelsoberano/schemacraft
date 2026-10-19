import { describe, expect, it } from "vitest";

import type { CarriedFact, InspectionOptions, NodeState } from "@/shared/contracts";
import { previewSnapshot } from "@/shared/ipc/previewConnectionBackend";

import { inspectedTarget, inspectorScope } from "./inspectorScope";

const EVERYTHING: InspectionOptions = {
  schemas: [],
  includeViews: true,
  includeProgrammability: true,
  includeModuleDefinitions: true,
};

function node(schema: string, name: string, isHidden = false): NodeState {
  return { name: { schema, name }, position: { x: 0, y: 0 }, isCollapsed: false, isHidden };
}

describe("inspectorScope", () => {
  it("names the hidden entities by key and knows the whole project", () => {
    const scope = inspectorScope(
      previewSnapshot("Shop", "full"),
      [node("sales", "Orders"), node("hr", "Employees", true), node("sales", "RecentOrders", true)],
      EVERYTHING,
    );
    expect([...scope.hiddenKeys].sort()).toEqual(["hr.Employees", "sales.RecentOrders"]);
    expect(scope.isDiagramOnly).toBe(false);
    expect(scope.isSchemaFiltered).toBe(false);
  });

  it("passes the capture's verdicts and kept facts on, and their absence in a 1.0 file", () => {
    const partial = previewSnapshot("Shop", "partial");
    const carried: CarriedFact[] = [
      {
        object: { schema: "sales", name: "Orders" },
        fact: { kind: "checkConstraint", name: "CK_Orders_Total" },
        readAt: "2026-10-12T08:00:00Z",
      },
    ];
    expect(inspectorScope({ ...partial, carriedOver: carried }, [], EVERYTHING)).toMatchObject({
      coverage: {
        objects: partial.access?.coverage.objects,
        definitions: partial.access?.coverage.definitions,
      },
      carriedOver: carried,
    });

    const formatOne = { ...partial, access: undefined, carriedOver: undefined };
    expect(inspectorScope(formatOne, [], EVERYTHING)).toMatchObject({
      coverage: null,
      carriedOver: [],
    });
  });

  it("marks a read narrowed to some schemas, which dropped the keys leaving them", () => {
    const snapshot = previewSnapshot("Shop", "full");
    expect(inspectorScope(snapshot, [], { ...EVERYTHING, schemas: ["sales"] })).toMatchObject({
      isSchemaFiltered: true,
    });
    expect(inspectorScope(snapshot, [], EVERYTHING)).toMatchObject({ isSchemaFiltered: false });
  });
});

describe("inspectedTarget", () => {
  it("gives entities precedence over a module, and multiple selection its own empty state", () => {
    const module = { kind: "routine" as const, name: { schema: "sales", name: "PlaceOrder" } };
    expect(inspectedTarget(["sales.Orders"], module)).toEqual({
      kind: "entity",
      key: "sales.Orders",
    });
    expect(inspectedTarget(["sales.Orders", "hr.Employees"], module)).toEqual({
      kind: "multiple",
      count: 2,
    });
    expect(inspectedTarget([], module)).toEqual({ kind: "module", ref: module });
    expect(inspectedTarget([], null)).toEqual({ kind: "none" });
  });
});
