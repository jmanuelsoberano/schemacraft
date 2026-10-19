import { assert, describe, expect, it, vi } from "vitest";
import type {
  ConnectionSettings,
  InspectionOptions,
  InspectionStage,
  SchemaSnapshot,
} from "@/shared/contracts";
import { accessChanged, withUncheckedFacts } from "./previewAccess";
import { codeCaptureChanges, codeDiff, moduleDefinitions } from "./previewCode";
import { previewConnectionBackend, previewSnapshot } from "./previewConnectionBackend";

const options: InspectionOptions = {
  schemas: [],
  includeViews: true,
  includeProgrammability: true,
  includeModuleDefinitions: true,
};
const codeOf = (snapshot: SchemaSnapshot) => {
  assert(snapshot.programmability);
  return snapshot.programmability;
};
const noReadableText = (snapshot: SchemaSnapshot) =>
  moduleDefinitions(codeOf(snapshot)).every((definition) => definition.status !== "readable");

describe("code in the browser preview", () => {
  it("offers an Inspector sample with 600 procedures, a 2,000-line body and distinct states", () => {
    const snapshot = previewSnapshot("SchemaCraftCodeExplorer");
    const code = codeOf(snapshot);
    expect(
      code.routines.filter(
        (routine) => routine.name.schema === "sales" && routine.kind === "procedure",
      ),
    ).toHaveLength(600);
    const long = code.routines.find((routine) => routine.name.name === "usp_Example001");
    assert(long?.body.language === "sql" && long.body.definition.status === "readable");
    expect(long.body.definition.text.split("\n")).toHaveLength(2000);
    expect(code.routines.some((routine) => routine.body.language === "clr")).toBe(true);
    expect(code.routines.some((routine) => routine.body.language === "unknown")).toBe(true);
    expect(new Set(moduleDefinitions(code).map((definition) => definition.status))).toEqual(
      new Set(["readable", "encrypted", "notVisible", "notRecorded"]),
    );
    expect(code.carriedOver).toHaveLength(1);
    const off = previewSnapshot("SchemaCraftCodeExplorer", "full", {
      ...options,
      includeModuleDefinitions: false,
    });
    expect(noReadableText(off)).toBe(true);
    expect(codeOf(off).carriedOver ?? []).toEqual([]);
  });

  it("emits only requested stages with the same object and readable-text counts as the catalog", async () => {
    vi.useFakeTimers();
    const settings: ConnectionSettings = {
      provider: "sqlServer",
      host: "preview",
      port: null,
      instance: null,
      database: "Shop",
      authentication: { mode: "integrated" },
      encryption: "mandatory",
      trustServerCertificate: true,
      connectTimeoutSeconds: 15,
    };
    try {
      for (const codeOptions of [
        { includeProgrammability: true, includeModuleDefinitions: true },
        { includeProgrammability: true, includeModuleDefinitions: false },
        { includeProgrammability: false, includeModuleDefinitions: false },
      ]) {
        const counts: Partial<Record<InspectionStage, number | null>> = {};
        const running = previewConnectionBackend.inspectDatabase(
          settings,
          { ...options, ...codeOptions },
          (event) => {
            if (event.event === "progress") counts[event.data.stage] = event.data.count;
          },
        );
        await vi.runAllTimersAsync();
        const result = await running;
        const code = codeOf(result);
        if (codeOptions.includeProgrammability)
          expect(counts.readingProgrammability).toBe(code.routines.length + code.triggers.length);
        else expect(counts).not.toHaveProperty("readingProgrammability");
        if (codeOptions.includeModuleDefinitions)
          expect(counts.readingModuleDefinitions).toBe(
            moduleDefinitions(code).filter((definition) => definition.status === "readable").length,
          );
        else expect(counts).not.toHaveProperty("readingModuleDefinitions");
      }
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps the sample's original comment and CRLF text and its parameter and trigger facts", () => {
    const code = codeOf(previewSnapshot("SchemaCraftCode"));
    const place = code.routines.find((routine) => routine.name.name === "usp_PlaceOrder");
    assert(place);
    expect(place.parameters.some((parameter) => parameter.isOutput)).toBe(true);
    assert(place.body.language === "sql" && place.body.definition.status === "readable");
    expect(place.body.definition.text).toMatch(/^-- Orders/u);
    const crlf = code.routines.find((routine) => routine.name.name === "usp_Crlf");
    assert(crlf?.body.language === "sql" && crlf.body.definition.status === "readable");
    expect(crlf.body.definition.text).toContain(";  \r\n");
    expect(
      code.routines.some((routine) => routine.parameters.some((parameter) => parameter.isReadOnly)),
    ).toBe(true);
    expect(
      code.triggers.some((trigger) => trigger.events.some((event) => event.order === "first")),
    ).toBe(true);
    expect(code.triggers.some((trigger) => trigger.isNotForReplication)).toBe(true);
  });

  it("applies schema and views filters to code, and keeps the two options independent", () => {
    const filtered = previewSnapshot("Shop", "full", {
      ...options,
      schemas: ["sales"],
      includeViews: false,
    });
    expect(codeOf(filtered).routines.every((routine) => routine.name.schema === "sales")).toBe(
      true,
    );
    expect(codeOf(filtered).views).toEqual([]);
    expect(
      codeOf(filtered).triggers.some((trigger) => trigger.parent.name === "RecentOrders"),
    ).toBe(false);
    const codeOnly = previewSnapshot("Shop", "full", { ...options, schemas: ["code_only"] });
    expect(codeOnly.tables).toEqual([]);
    expect(codeOf(codeOnly).routines).toHaveLength(1);
    const off = previewSnapshot("Shop", "full", { ...options, includeProgrammability: false });
    expect(codeOf(off).routines).toEqual([]);
    const textsOff = previewSnapshot("Shop", "full", {
      ...options,
      includeModuleDefinitions: false,
    });
    expect(codeOf(textsOff).routines.length).toBeGreaterThan(0);
    expect(noReadableText(textsOff)).toBe(true);
  });

  it("keeps owner code over a weaker read, but removes every saved text when text saving is off", () => {
    const owner = previewSnapshot("Shop");
    const reader = previewSnapshot("Shop", "partial");
    expect(codeOf(reader).routines.every((routine) => routine.kind !== "procedure")).toBe(true);
    const merged = withUncheckedFacts(reader, owner);
    expect(codeOf(merged).routines).toHaveLength(codeOf(owner).routines.length);
    expect(codeDiff(owner, merged).changes).toEqual([]);
    expect(codeDiff(owner, merged).notChecked.length).toBeGreaterThan(0);
    const textsOff = withUncheckedFacts(
      previewSnapshot("Shop", "partial", { ...options, includeModuleDefinitions: false }),
      owner,
    );
    expect(codeOf(textsOff).routines).toHaveLength(codeOf(owner).routines.length);
    expect(noReadableText(textsOff)).toBe(true);
    expect(codeCaptureChanges(owner, textsOff)).toContainEqual(
      expect.objectContaining({ kind: "moduleDefinitionsNoLongerRecorded" }),
    );
  });

  it("reports first capture instead of additions and compares coverage only when both recorded it", () => {
    const owner = previewSnapshot("Shop");
    const older = structuredClone(owner);
    delete older.programmability;
    assert(older.access);
    delete older.access.coverage.programmability;
    delete older.access.coverage.moduleDefinitions;
    expect(codeDiff(older, owner).changes).toEqual([]);
    expect(codeCaptureChanges(older, owner).map((change) => change.kind)).toEqual([
      "programmabilityRecorded",
      "moduleDefinitionsRecorded",
    ]);
    expect(accessChanged(older, owner)).toBe(false);
    expect(
      codeDiff(previewSnapshot("Shop", "partial"), owner).nowAvailable.some(
        (entry) => entry.part === "whole",
      ),
    ).toBe(true);
  });

  it("keeps saved code after failure and reports an empty first capture failure explicitly", () => {
    const owner = previewSnapshot("Shop");
    for (const failure of ["objects", "definitions", "timeout"] as const) {
      const fresh = previewSnapshot("Shop", "full", options, failure);
      const merged = withUncheckedFacts(fresh, owner);
      expect(merged.tables).toEqual(owner.tables);
      expect(codeOf(merged).routines).toEqual(codeOf(owner).routines);
      expect(codeDiff(owner, merged).changes).toEqual([]);
      expect(codeDiff(owner, merged).readFailures.length).toBeGreaterThan(0);
    }
    const older = { ...owner };
    delete older.programmability;
    const failure = previewSnapshot("Shop", "full", options, "objects");
    expect(codeDiff(older, failure).notChecked).toEqual([]);
    expect(codeDiff(older, failure).readFailures).toContainEqual({
      family: "objects",
      reason: "queryFailed",
    });
  });
});
