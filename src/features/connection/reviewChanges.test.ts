import { describe, expect, it } from "vitest";

import type { SchemaDiff } from "@/shared/contracts";

import { hasObjectChanges, isUpToDate } from "./reviewChanges";

const none = { added: 0, removed: 0, changed: 0 };

function diff(partial: Partial<SchemaDiff> = {}): SchemaDiff {
  return {
    tables: [],
    views: [],
    foreignKeys: [],
    foreignKeysToInvisibleTables: [],
    summary: { tables: none, views: none, foreignKeys: none, code: none },
    code: { changes: [], notChecked: [], nowAvailable: [], readFailures: [] },
    notChecked: [],
    nowAvailable: [],
    accessChanged: false,
    captureChanges: [],
    hasObjectChanges: false,
    isUpToDate: true,
    ...partial,
  };
}

const customers = { schema: "dbo", name: "Customers" };

describe("the review's verdicts", () => {
  it("take Rust's word that nothing at all would change", () => {
    expect(isUpToDate(diff())).toBe(true);
    expect(hasObjectChanges(diff())).toBe(false);
  });

  it("take Rust's word on schema changes", () => {
    const changed = diff({
      summary: { tables: none, views: none, foreignKeys: { ...none, added: 1 }, code: none },
      hasObjectChanges: true,
      isUpToDate: false,
    });
    expect(hasObjectChanges(changed)).toBe(true);
    expect(isUpToDate(changed)).toBe(false);
  });

  it("never work the verdicts out again from the lists", () => {
    // Rust decides with facts the lists do not show, such as code that changed only in its
    // body; the review follows its verdict even where the lists alone would say otherwise.
    const weaker = diff({
      notChecked: [{ object: customers, fact: { kind: "table" }, readAt: "2026-10-15T09:00:00Z" }],
      isUpToDate: false,
    });
    expect(isUpToDate(weaker)).toBe(false);
    expect(hasObjectChanges(weaker)).toBe(false);
    expect(isUpToDate(diff({ nowAvailable: [], isUpToDate: false }))).toBe(false);
  });

  it("are not up to date when a project saved before 1.2 records the state of its indexes", () => {
    const firstCapture = diff({
      captureChanges: [{ kind: "indexAndConstraintStateRecorded", count: 17 }],
      isUpToDate: false,
    });
    expect(hasObjectChanges(firstCapture)).toBe(false);
    expect(isUpToDate(firstCapture)).toBe(false);
  });
});
