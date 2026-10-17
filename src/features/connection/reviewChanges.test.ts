import { describe, expect, it } from "vitest";

import type { SchemaDiff } from "@/shared/contracts";

import { countChanges, isUpToDate } from "./reviewChanges";

const none = { added: 0, removed: 0, changed: 0 };

function diff(partial: Partial<SchemaDiff> = {}): SchemaDiff {
  return {
    tables: [],
    views: [],
    foreignKeys: [],
    foreignKeysToInvisibleTables: [],
    summary: { tables: none, views: none, foreignKeys: none },
    notChecked: [],
    nowAvailable: [],
    accessChanged: false,
    ...partial,
  };
}

const customers = { schema: "dbo", name: "Customers" };

describe("isUpToDate", () => {
  it("holds only when nothing at all would change", () => {
    expect(isUpToDate(diff())).toBe(true);
  });

  it("is false for schema changes, as before", () => {
    const changed = diff({
      summary: { tables: none, views: none, foreignKeys: { ...none, added: 1 } },
    });
    expect(countChanges(changed.summary)).toBe(1);
    expect(isUpToDate(changed)).toBe(false);
  });

  it("is false for a weaker login, whose unchecked items must be shown", () => {
    const weaker = diff({
      notChecked: [{ object: customers, fact: { kind: "table" }, readAt: "2026-10-15T09:00:00Z" }],
    });
    expect(countChanges(weaker.summary)).toBe(0);
    expect(isUpToDate(weaker)).toBe(false);
  });

  it("is false after a GRANT, so the texts now readable reach the project", () => {
    const stronger = diff({
      nowAvailable: [{ object: customers, fact: { kind: "columnDefault", column: "CreatedAt" } }],
    });
    expect(isUpToDate(stronger)).toBe(false);
  });

  it("is false when only the access verdict changed, as for a refreshed 1.0 project", () => {
    expect(isUpToDate(diff({ accessChanged: true }))).toBe(false);
  });
});
