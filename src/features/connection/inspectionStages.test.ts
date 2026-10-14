import { describe, expect, it } from "vitest";

import { DISPLAYED_STAGES, stageStatus } from "./inspectionStages";

describe("stageStatus", () => {
  it("shows every stage pending before anything is reported", () => {
    for (const stage of DISPLAYED_STAGES) {
      expect(stageStatus({}, stage)).toBe("pending");
    }
  });

  it("activates connecting first and the catalog stages once connected", () => {
    const progress = { connecting: null };
    expect(stageStatus(progress, "connecting")).toBe("active");
    expect(stageStatus(progress, "readingColumns")).toBe("active");
    expect(stageStatus(progress, "assembling")).toBe("pending");
  });

  it("marks catalog stages done as they report counts, in any order", () => {
    const progress = { connecting: null, readingForeignKeys: 8, readingObjects: 7 };
    expect(stageStatus(progress, "connecting")).toBe("done");
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
