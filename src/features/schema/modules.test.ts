import { describe, expect, it } from "vitest";

import { previewSnapshot } from "@/shared/ipc/previewConnectionBackend";

import { findModule, listModules, moduleKey, routineModuleKind } from "./modules";

describe("module identities and list metadata", () => {
  it("distinguishes a routine from triggers with the same name on different parents", () => {
    const name = { schema: "sales", name: "Audit" };
    const keys = [
      moduleKey({ kind: "routine", name }),
      moduleKey({ kind: "trigger", parent: name, name: "Audit" }),
      moduleKey({ kind: "trigger", parent: { ...name, name: "Orders" }, name: "Audit" }),
    ];
    expect(new Set(keys).size).toBe(3);
  });

  it("keeps qualified-name components separate when identifiers contain dots or delimiters", () => {
    const names = [
      { schema: "sales.archive", name: "Orders" },
      { schema: "sales", name: "archive.Orders" },
      { schema: 'sales","archive', name: "Orders" },
      { schema: "sales", name: 'archive","Orders' },
    ];
    expect(new Set(names.map((name) => moduleKey({ kind: "routine", name }))).size).toBe(4);
    expect(
      new Set(names.map((parent) => moduleKey({ kind: "trigger", parent, name: "Audit" }))).size,
    ).toBe(4);
  });

  it("looks up the exact stored object and exposes metadata without copying its SQL", () => {
    const snapshot = previewSnapshot("Shop");
    const items = listModules(snapshot);
    const procedure = items.find((item) => item.name === "usp_PlaceOrder");
    expect(procedure).toMatchObject({
      kind: "procedure",
      parameterCount: 2,
      implementation: "sql",
      isEncrypted: false,
    });
    expect(procedure).not.toHaveProperty("body");
    expect(items.find((item) => item.name === "usp_Secret")?.isEncrypted).toBe(true);
    for (const item of items) {
      expect(item.key).toBe(moduleKey(item.ref));
      expect(findModule(snapshot, item.ref)).not.toBeNull();
    }
    expect(
      findModule(snapshot, { kind: "routine", name: { schema: "absent", name: "usp_PlaceOrder" } }),
    ).toBeNull();
  });

  it("does not relabel an unknown kind as a function or invent objects in an older file", () => {
    expect(routineModuleKind("unknown")).toBe("unknown");
    expect(routineModuleKind("aggregateFunction")).toBe("function");
    const snapshot = previewSnapshot("Shop");
    delete snapshot.programmability;
    expect(listModules(snapshot)).toEqual([]);
    expect(
      findModule(snapshot, { kind: "routine", name: { schema: "sales", name: "usp_PlaceOrder" } }),
    ).toBeNull();
  });
});
