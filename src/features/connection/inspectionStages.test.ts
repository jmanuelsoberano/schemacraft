import { describe, expect, it } from "vitest";

import { DISPLAYED_STAGES, displayedStages, stageStatus } from "./inspectionStages";

describe("stageStatus", () => {
  it("omits code stages switched off for this read", () => {
    const options = {
      schemas: [],
      includeViews: true,
      includeProgrammability: true,
      includeModuleDefinitions: true,
    };
    expect(displayedStages(options)).toEqual(DISPLAYED_STAGES);
    expect(displayedStages({ ...options, includeModuleDefinitions: false })).toContain(
      "readingProgrammability",
    );
    expect(displayedStages({ ...options, includeModuleDefinitions: false })).not.toContain(
      "readingModuleDefinitions",
    );
    for (const includeModuleDefinitions of [true, false]) {
      const stages = displayedStages({
        ...options,
        includeProgrammability: false,
        includeModuleDefinitions,
      });
      expect(stages).not.toContain("readingProgrammability");
      expect(stages).not.toContain("readingModuleDefinitions");
    }
  });
  it("lists object metadata before module texts and completes them independently", () => {
    expect(DISPLAYED_STAGES.indexOf("readingProgrammability")).toBeLessThan(
      DISPLAYED_STAGES.indexOf("readingModuleDefinitions"),
    );
    expect(DISPLAYED_STAGES.indexOf("readingModuleDefinitions")).toBeLessThan(
      DISPLAYED_STAGES.indexOf("assembling"),
    );
    const progress = { connecting: null, readingProgrammability: 12 };
    expect(stageStatus(progress, "readingProgrammability")).toBe("done");
    expect(stageStatus(progress, "readingModuleDefinitions")).toBe("active");
    expect(
      stageStatus({ ...progress, readingModuleDefinitions: 10 }, "readingModuleDefinitions"),
    ).toBe("done");
  });
  it("shows every stage pending before anything is reported", () => {
    for (const stage of DISPLAYED_STAGES) {
      expect(stageStatus({}, stage)).toBe("pending");
    }
  });

  it("activates connecting first and the catalog stages once connected", () => {
    const progress = { connecting: null };
    expect(stageStatus(progress, "connecting")).toBe("active");
    expect(stageStatus(progress, "checkingAccess")).toBe("active");
    expect(stageStatus(progress, "readingColumns")).toBe("active");
    expect(stageStatus(progress, "assembling")).toBe("pending");
  });

  it("marks catalog stages done as they report counts, in any order", () => {
    const progress = { connecting: null, readingForeignKeys: 8, readingObjects: 7 };
    expect(stageStatus(progress, "connecting")).toBe("done");
    expect(stageStatus(progress, "checkingAccess")).toBe("active");
    expect(stageStatus({ ...progress, checkingAccess: null }, "checkingAccess")).toBe("done");
    expect(stageStatus(progress, "readingForeignKeys")).toBe("done");
    expect(stageStatus(progress, "readingObjects")).toBe("done");
    expect(stageStatus(progress, "readingColumns")).toBe("active");
  });

  it("finishes assembling when completion is reported", () => {
    const assembling = { connecting: null, readingObjects: 7, assembling: null };
    expect(stageStatus(assembling, "assembling")).toBe("active");
    const completed = { ...assembling, completed: 7 };
    expect(stageStatus(completed, "assembling")).toBe("done");
    expect(stageStatus(completed, "completed")).toBe("done");
  });
});
