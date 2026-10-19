import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { assert, describe, expect, it, vi } from "vitest";
import type { SchemaDiff, SchemaSnapshot } from "@/shared/contracts";

const state = vi.hoisted((): { snapshot: SchemaSnapshot | null } => ({ snapshot: null }));
vi.mock("@/features/project/projectStore", () => ({
  useProjectStore: (select: (value: object) => unknown) =>
    select({ project: state.snapshot === null ? null : { content: { snapshot: state.snapshot } } }),
}));
vi.mock("./accessReportStore", () => ({
  useAccessReportStore: (select: (value: object) => unknown) =>
    select({ isOpen: true, close: () => undefined }),
}));
vi.mock("@/shared/ui/Dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/shared/i18n/useI18n", async () => {
  const { createCatalogTranslator } = await import("@/shared/i18n/translator");
  const { englishMessages } = await import("@/shared/i18n/messages/en");
  return { useI18n: () => createCatalogTranslator(englishMessages, "en") };
});

const { AccessReportDialog } = await import("./AccessReportDialog");
const { AccessCheckNotice } = await import("../connection/AccessCheckNotice");
const { ReviewChangesPanel } = await import("../connection/ReviewChangesPanel");
const { previewSnapshot } = await import("@/shared/ipc/previewConnectionBackend");

const emptyDiff = (): SchemaDiff => {
  const none = { added: 0, removed: 0, changed: 0 };
  return {
    tables: [],
    views: [],
    foreignKeys: [],
    foreignKeysToInvisibleTables: [],
    summary: { tables: none, views: none, foreignKeys: none, code: none },
    notChecked: [],
    nowAvailable: [],
    captureChanges: [],
    accessChanged: false,
    hasObjectChanges: false,
    isUpToDate: true,
    code: { changes: [], notChecked: [], nowAvailable: [], readFailures: [] },
  };
};

describe("code access messages", () => {
  it("adds the code sentence to the connection notice only while texts are included", () => {
    const access = previewSnapshot("Shop", "partial").access;
    assert(access);
    const included = renderToString(
      createElement(AccessCheckNotice, { access, database: "Shop", includeCode: true }),
    );
    const excluded = renderToString(
      createElement(AccessCheckNotice, { access, database: "Shop", includeCode: false }),
    );
    expect(included).toContain("Some module code may not be visible");
    expect(excluded).not.toContain("Some module code may not be visible");
    expect(included).toContain("CHECK");
    expect(excluded).toContain("CHECK");
  });

  it("does not count uncaptured texts as readable when saving texts is off or fails", () => {
    for (const reason of ["optionOff", "queryFailed", "timedOut"] as const) {
      state.snapshot = previewSnapshot("Shop");
      assert(state.snapshot.programmability);
      assert(state.snapshot.access);
      state.snapshot.programmability.capture.definitions = { status: "notRead", reason };
      state.snapshot.access.coverage.moduleDefinitions = "notAvailable";
      const markup = renderToString(createElement(AccessReportDialog));
      expect(markup).not.toContain("readable ·");
      expect(markup).not.toContain("GRANT VIEW DEFINITION");
      expect(markup).toContain(
        reason === "optionOff"
          ? "Left out by the inspection options"
          : reason === "queryFailed"
            ? "query failed"
            : "query timed out",
      );
    }
    state.snapshot = null;
  });

  it("limits an unchanged review to visible code even when relational access is full", () => {
    const capture = previewSnapshot("Shop");
    assert(capture.access);
    assert(capture.programmability);
    capture.access.coverage.programmability = "partial";
    capture.access.coverage.moduleDefinitions = "notAvailable";
    expect(capture.access.level).toBe("full");
    const markup = renderToString(
      createElement(ReviewChangesPanel, { diff: emptyDiff(), capture }),
    );
    expect(markup).toContain("No changes in what this login can read");
    capture.programmability.capture = {
      objects: { status: "notRead", reason: "optionOff" },
      definitions: { status: "notRead", reason: "optionOff" },
    };
    const off = renderToString(createElement(ReviewChangesPanel, { diff: emptyDiff(), capture }));
    expect(off).not.toContain("No changes in what this login can read");
  });

  it("shows an explicit failed first read even when there is no saved code", () => {
    const capture = previewSnapshot("Shop");
    const none = { added: 0, removed: 0, changed: 0 };
    const diff: SchemaDiff = {
      tables: [],
      views: [],
      foreignKeys: [],
      foreignKeysToInvisibleTables: [],
      summary: { tables: none, views: none, foreignKeys: none, code: none },
      notChecked: [],
      nowAvailable: [],
      captureChanges: [],
      accessChanged: false,
      hasObjectChanges: false,
      isUpToDate: false,
      code: {
        changes: [],
        notChecked: [],
        nowAvailable: [],
        readFailures: [{ family: "objects", reason: "queryFailed" }],
      },
    };
    const markup = renderToString(createElement(ReviewChangesPanel, { diff, capture }));
    expect(markup).toContain("Some code could not be checked");
    expect(markup).toContain("query failed");
    expect(markup).not.toContain("up to date");
    expect(markup).not.toContain("VIEW DEFINITION");
    diff.code.notChecked = [
      {
        object: { kind: "routine", name: { schema: "sales", name: "usp_PlaceOrder" } },
        part: "definition",
        readAt: capture.extractedAt,
      },
    ];
    const kept = renderToString(createElement(ReviewChangesPanel, { diff, capture }));
    expect(kept).toContain("1 item could not be checked and keeps its saved value");
    expect(kept).not.toContain("isn&#x27;t visible to this login");
  });

  it("distinguishes removing code from first capture and mixed recording changes", () => {
    const capture = previewSnapshot("Shop");
    const diff = emptyDiff();
    diff.isUpToDate = false;
    diff.captureChanges = [{ kind: "moduleDefinitionsNoLongerRecorded", count: 4 }];
    const removed = renderToString(createElement(ReviewChangesPanel, { diff, capture }));
    expect(removed).toContain("will remove the saved code excluded");
    expect(removed).not.toContain("details the project didn&#x27;t have yet");
    diff.captureChanges.push({ kind: "indexAndConstraintStateRecorded", count: 2 });
    const mixed = renderToString(createElement(ReviewChangesPanel, { diff, capture }));
    expect(mixed).toContain("change what the project records");
    expect(mixed).not.toContain("details the project didn&#x27;t have yet");
    diff.captureChanges = [{ kind: "moduleDefinitionsRecorded", count: 4 }];
    const recorded = renderToString(createElement(ReviewChangesPanel, { diff, capture }));
    expect(recorded).toContain("details the project didn&#x27;t have yet");
  });
});
