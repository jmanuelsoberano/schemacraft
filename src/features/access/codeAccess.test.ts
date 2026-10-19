import { describe, expect, it } from "vitest";
import type { AccessProfile, CaptureState, SchemaSnapshot } from "@/shared/contracts";
import { accessCauses, codeCaptureCause, codeGrantHelps } from "./accessCause";
import { personas, translatorFor } from "./testFixtures";

function capture(state: CaptureState): SchemaSnapshot & { access: AccessProfile } {
  return {
    databaseName: "Shop",
    serverVersion: null,
    extractedAt: "2026-10-19T12:00:00Z",
    tables: [],
    views: [],
    foreignKeys: [],
    access: {
      ...personas.owner,
      probe: { ...personas.owner.probe, executeDenials: 0 },
      coverage: {
        ...personas.owner.coverage,
        programmability: "partial",
        moduleDefinitions: "notAvailable",
      },
    },
    programmability: {
      capture: { objects: state, definitions: state },
      routines: [],
      views: [],
      triggers: [],
    },
  };
}

describe("code access explanations", () => {
  it("reports code permission gaps without changing the diagram's access causes", () => {
    const snapshot = capture({ status: "read" });
    expect(accessCauses(snapshot.access)).toEqual([]);
    expect(codeCaptureCause(snapshot, "objects", translatorFor("en"))).toContain("VIEW DEFINITION");
    expect(codeGrantHelps(snapshot)).toBe(true);
    snapshot.access.probe.executeDenials = 1;
    expect(codeCaptureCause(snapshot, "objects", translatorFor("en"))).toContain("EXECUTE denial");
    expect(codeGrantHelps(snapshot)).toBe(false);
  });

  it("does not call options, failures or timeouts missing permissions", () => {
    for (const reason of ["optionOff", "queryFailed", "timedOut"] as const) {
      const snapshot = capture({ status: "notRead", reason });
      const text = codeCaptureCause(snapshot, "definitions", translatorFor("en"));
      expect(text).not.toContain("VIEW DEFINITION");
      expect(text).not.toContain("not visible to this login");
      expect(codeGrantHelps(snapshot)).toBe(false);
    }
  });

  it("does not treat encrypted modules as gaps when coverage is complete", () => {
    const snapshot = capture({ status: "read" });
    snapshot.access.coverage = {
      ...snapshot.access.coverage,
      programmability: "complete",
      moduleDefinitions: "complete",
    };
    snapshot.access.counts.moduleDefinitionsEncrypted = 1;
    expect(codeCaptureCause(snapshot, "definitions", translatorFor("en"))).toBeNull();
    expect(codeGrantHelps(snapshot)).toBe(false);
  });
});
