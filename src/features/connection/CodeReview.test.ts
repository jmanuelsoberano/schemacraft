import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { assert, describe, expect, it, vi } from "vitest";
import type { CaptureChange, CodeProperty, SchemaSnapshot } from "@/shared/contracts";

const language = vi.hoisted((): { locale: "en" | "es" } => ({ locale: "en" }));
vi.mock("@/shared/i18n/useI18n", async () => {
  const { createCatalogTranslator } = await import("@/shared/i18n/translator");
  const { messageCatalogs } = await import("@/shared/i18n/messages/catalogs");
  return {
    useI18n: () => createCatalogTranslator(messageCatalogs[language.locale], language.locale),
  };
});

const { CodeChangeItem, CodeFactsSection, CaptureChangeItem } = await import("./CodeReview");
const name = { schema: "sales", name: "usp_PlaceOrder" };
const object = { kind: "routine", name } as const;
const snapshot: SchemaSnapshot = {
  databaseName: "Shop",
  serverVersion: null,
  extractedAt: "2026-10-19T12:00:00Z",
  tables: [],
  views: [],
  foreignKeys: [],
  programmability: {
    capture: { objects: { status: "read" }, definitions: { status: "read" } },
    views: [],
    triggers: [],
    routines: [
      {
        name,
        kind: "procedure",
        body: {
          language: "sql",
          definition: {
            status: "readable",
            text: "CREATE PROCEDURE sales.usp_PlaceOrder AS SELECT 1;",
          },
        },
        parameters: [],
        returns: null,
        columns: [],
      },
    ],
  },
};

describe("code review", () => {
  it("names each changed property and escapes object names without copying module bodies", () => {
    const properties: CodeProperty[] = [
      "definition",
      "encryption",
      "implementation",
      "parameters",
      "returnType",
      "columns",
      "timing",
      "events",
      "firingOrder",
      "enabled",
      "notForReplication",
      "checkOption",
      "indexed",
      "kind",
    ];
    const markup = renderToString(
      createElement(CodeChangeItem, {
        change: {
          kind: "changed",
          object: { kind: "routine", name: { schema: "sales", name: "<script>" } },
          routineKind: "procedure",
          properties,
        },
      }),
    );
    expect(markup).toContain("sales.&lt;script&gt;");
    expect(markup).toContain("Code changed");
    expect(markup).toContain("Encryption changed");
    expect(markup).toContain("Firing order changed");
    expect(markup).not.toContain("CREATE PROCEDURE");
  });

  it("distinguishes first capture from removing saved code, with singular and plural counts", () => {
    const cases: [CaptureChange, string][] = [
      [
        {
          kind: "programmabilityRecorded",
          counts: { procedures: 1, functions: 2, triggers: 1, views: 0 },
        },
        "1 procedure",
      ],
      [
        {
          kind: "programmabilityNoLongerRecorded",
          counts: { procedures: 2, functions: 0, triggers: 0, views: 1 },
        },
        "will be removed",
      ],
      [
        { kind: "moduleDefinitionsRecorded", count: 1 },
        "1 module will be saved in this project file",
      ],
      [{ kind: "moduleDefinitionsNoLongerRecorded", count: 2 }, "2 modules will be removed"],
    ];
    for (const [change, expected] of cases)
      expect(renderToString(createElement(CaptureChangeItem, { change }))).toContain(expected);
  });

  it("groups kept objects by kind from the saved snapshot and preserves text read dates", () => {
    assert(snapshot.programmability);
    const fresh = { ...snapshot, programmability: { ...snapshot.programmability, routines: [] } };
    const entries = [
      { object, part: "whole" as const, readAt: "2026-10-18T12:00:00Z" },
      { object, part: "definition" as const, readAt: "2026-10-15T12:00:00Z" },
    ];
    const markup = renderToString(
      createElement(CodeFactsSection, {
        entries,
        snapshot: fresh,
        previous: snapshot,
        mode: "notChecked",
      }),
    );
    expect(markup).toContain("1 procedure");
    expect(markup).not.toContain("2 procedures");
    expect(markup).toContain("2026");
    expect(markup).toContain("Object");
    expect(markup).toContain("Code");
  });

  it("uses desencadenador in Spanish counted lines", () => {
    language.locale = "es";
    try {
      const markup = renderToString(
        createElement(CaptureChangeItem, {
          change: {
            kind: "programmabilityRecorded",
            counts: { procedures: 0, functions: 0, triggers: 1, views: 0 },
          },
        }),
      );
      expect(markup).toContain("1 desencadenador");
    } finally {
      language.locale = "en";
    }
  });
});
