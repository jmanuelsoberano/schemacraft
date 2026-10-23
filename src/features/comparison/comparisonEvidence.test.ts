import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatDateTime } from "@/shared/i18n/formatDate";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";

import { comparisonCaptureFields } from "./comparisonEvidence";
import { comparisonDocumentFixture, comparisonFixture } from "./comparisonFixtures";
import { ComparisonSourcePane } from "./ComparisonSourcePane";

describe("independent comparison evidence presentation", () => {
  it.each(["en", "es"] as const)(
    "keeps the readable original available when the other side is absent in %s",
    (locale) => {
      const { t } = createCatalogTranslator(messageCatalogs[locale], locale);
      for (const readableSide of ["reference", "compared"] as const) {
        const html = renderToStaticMarkup(
          createElement(
            "div",
            null,
            ...(["reference", "compared"] as const).map((side) =>
              createElement(ComparisonSourcePane, {
                key: side,
                side,
                text: side === readableSide ? "SELECT '<script>readable</script>'" : null,
                t,
              }),
            ),
          ),
        );
        expect(html.match(/<textarea/gu)).toHaveLength(1);
        expect(html).toContain("&lt;script&gt;readable&lt;/script&gt;");
        expect(html).not.toContain("<script>");
        expect(html).toContain(t("comparison.sourceSideUnavailable"));
        expect(html).toContain(`${t("codeViewer.copy")} · ${t(`comparison.${readableSide}`)}`);
      }
    },
  );

  it("does not infer captured families from requested inspection options", () => {
    const snapshot = comparisonDocumentFixture().project.snapshot;
    const translator = createCatalogTranslator(messageCatalogs.en, "en");
    const fields = comparisonCaptureFields(snapshot, undefined, translator);
    expect(
      fields.every((field) => field.value === translator.t("comparison.status.notRecorded")),
    ).toBe(true);
  });

  it.each(["en", "es"] as const)(
    "shows per-side scope, partial coverage, optional failures and historical dates in %s",
    (locale) => {
      const translator = createCatalogTranslator(messageCatalogs[locale], locale);
      const { t } = translator;
      const snapshot = comparisonDocumentFixture().project.snapshot;
      snapshot.access = {
        scope: { schemas: ["odd.schema"], includeViews: false },
        level: "partial",
        coverage: { objects: "partial", definitions: "notAvailable" },
        counts: { definitions: 0, definitionsNotVisible: 0, foreignKeysToInvisibleTables: 0 },
      };
      snapshot.programmability = {
        capture: {
          objects: { status: "notRead", reason: "permissionDenied" },
          definitions: { status: "notRead", reason: "optionOff" },
        },
        views: [],
        routines: [],
        triggers: [],
      };
      snapshot.dependencies = {
        capture: { status: "notRead", reason: "timedOut" },
        scope: snapshot.access.scope,
        observedAt: snapshot.extractedAt,
        sources: [],
        edges: [],
        limitations: [],
      };
      const readAt = "2026-10-20T00:00:00Z";
      snapshot.carriedOver = [
        { object: { schema: "odd.schema", name: "Orders" }, fact: { kind: "table" }, readAt },
      ];
      const capture = {
        ...comparisonFixture().reference,
        scope: snapshot.access.scope,
        accessLevel: snapshot.access.level,
      };
      const fields = new Map(
        comparisonCaptureFields(snapshot, capture, translator).map((field) => [
          field.label,
          field.value,
        ]),
      );
      expect(fields.get(t("comparison.capture.schemas"))).toBe("odd.schema");
      expect(fields.get(t("comparison.capture.views"))).toBe(t("review.value.no"));
      expect(fields.get(t("comparison.capture.access"))).toBe(
        t("comparison.capture.access.partial"),
      );
      expect(fields.get(t("comparison.capture.objects"))).toBe(t("dependencies.status.partial"));
      expect(fields.get(t("comparison.capture.modules"))).toBe(
        t("dependencies.reason.permissionDenied"),
      );
      expect(fields.get(t("comparison.capture.definitions"))).toBe(
        t("dependencies.reason.optionOff"),
      );
      expect(fields.get(t("comparison.dependencies"))).toBe(t("dependencies.reason.timedOut"));
      expect(fields.get(t("comparison.status.retained"))).toBe(formatDateTime(readAt, locale));
    },
  );
});
