import { describe, expect, it } from "vitest";

import type { AccessProfile, Completeness, SchemaSnapshot } from "@/shared/contracts";

import {
  definitionsCoverage,
  emptySchemaReason,
  listsEveryObject,
  objectsCoverage,
} from "./coverage";

function profile(objects: Completeness, definitions: Completeness): AccessProfile {
  return {
    probe: {
      canReadDefinitions: false,
      canReadData: true,
      explicitDenials: 0,
      seesObjects: true,
      schemas: [
        {
          name: "audit",
          canReadDefinitions: false,
          canReadData: true,
          isDenied: false,
          hasVisibleObjects: true,
        },
      ],
      databaseUser: "reporting",
    },
    scope: { schemas: [], includeViews: true },
    level: objects === "complete" && definitions === "complete" ? "full" : "partial",
    coverage: { objects, definitions },
    counts: { definitions: 4, definitionsNotVisible: 4, foreignKeysToInvisibleTables: 0 },
  };
}

const table = {
  name: { schema: "dbo", name: "Customers" },
  columns: [],
  primaryKey: null,
  indexes: [],
  checkConstraints: [],
};

function snapshot(access?: AccessProfile, tables = [table]): SchemaSnapshot {
  return {
    databaseName: "Shop",
    serverVersion: null,
    extractedAt: "2026-10-15T09:00:00Z",
    ...(access === undefined ? {} : { access }),
    tables,
    views: [],
    foreignKeys: [],
  };
}

const everything = { schemas: [], includeViews: true };

describe("coverage", () => {
  it("reads the frozen verdicts and says when none were recorded", () => {
    expect(objectsCoverage(snapshot())).toBe("notRecorded");
    expect(definitionsCoverage(snapshot())).toBe("notRecorded");
    expect(objectsCoverage(snapshot(profile("complete", "notAvailable")))).toBe("complete");
    expect(definitionsCoverage(snapshot(profile("complete", "notAvailable")))).toBe("notAvailable");
    expect(objectsCoverage(snapshot(profile("partial", "complete")))).toBe("partial");
    expect(objectsCoverage(snapshot(profile("notAvailable", "notAvailable")))).toBe("partial");
  });

  it("vouches for absences only when the object list is complete or was never judged", () => {
    expect(listsEveryObject(snapshot())).toBe(true);
    expect(listsEveryObject(snapshot(profile("complete", "partial")))).toBe(true);
    expect(listsEveryObject(snapshot(profile("partial", "complete")))).toBe(false);
  });

  it("tells an empty database from an empty selection and from objects not visible", () => {
    expect(emptySchemaReason(snapshot(profile("complete", "complete")), everything)).toBeNull();
    const empty = (access?: AccessProfile) => snapshot(access, []);
    expect(emptySchemaReason(empty(profile("complete", "complete")), everything)).toBe("database");
    expect(emptySchemaReason(empty(), everything)).toBe("database");
    expect(
      emptySchemaReason(empty(profile("complete", "complete")), {
        schemas: ["sales"],
        includeViews: true,
      }),
    ).toBe("selection");
    expect(
      emptySchemaReason(empty(profile("complete", "complete")), {
        schemas: [],
        includeViews: false,
      }),
    ).toBe("selection");
    expect(emptySchemaReason(empty(profile("partial", "complete")), everything)).toBe("notVisible");
  });
});
