import { describe, expect, it } from "vitest";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";

import {
  comparisonContextSvg,
  comparisonDefinition,
  filteredComparisonItems,
} from "./comparisonModel";
import {
  comparisonDocumentFixture,
  comparisonFixture,
  comparisonItemFixture,
} from "./comparisonFixtures";
import { buildComparisonReport } from "./comparisonReport";
import type { ComparisonReportLabels } from "./comparisonReport";
import { comparisonPropertyLabel, comparisonValueLabel } from "./comparisonPresentation";
import { projectReportCapture, reportCaptureFields } from "./comparisonReportCapture";

const labels: ComparisonReportLabels = {
  title: "Comparison",
  reference: "Reference",
  compared: "Compared",
  property: "Property",
  scope: "One filtered result",
  limitations: "Only captured evidence",
  sourceChanged: "Definition text differs",
  filter: "Filter",
  outcome: (value) => value,
  status: (value) => value,
  propertyName: (path) => path.join(" / "),
  propertyValue: (value) => value.value ?? "",
};

describe("the independent comparison report boundary", () => {
  it.each(["en", "es"] as const)(
    "retains known dependency changes and localized endpoint uncertainty using counts only in %s",
    (locale) => {
      const { t } = createCatalogTranslator(messageCatalogs[locale], locale);
      const comparison = comparisonFixture();
      const item = comparison.items[0];
      if (item === undefined) throw new Error("fixture item expected");
      const path = ["dependencies", "targetIdentity"];
      const uncertain = {
        observation: { status: "notVisible" as const, readAt: "2026-10-23T10:00:00Z" },
        value: JSON.stringify({
          unidentifiedTargets: 2,
          target: { server: "PRIVATE_TARGET_HOST", name: "PRIVATE_TARGET_NAME" },
          source: "PRIVATE_TARGET_SOURCE",
          future: "PRIVATE_TARGET_EXTENSION",
        }),
      };
      item.properties = [
        {
          path: ["dependencies"],
          result: "different",
          reference: { observation: item.reference, value: '{"knownReferences":1}' },
          compared: { observation: item.compared, value: '{"knownReferences":2}' },
        },
        {
          path,
          result: "notComparable",
          reference: uncertain,
          compared: { observation: { status: "absent", readAt: null }, value: null },
        },
        {
          path: ["dependencies", "private", "targetIdentity"],
          result: "notComparable",
          reference: { observation: item.reference, value: "PRIVATE_FUTURE_PATH" },
          compared: { observation: item.compared, value: null },
        },
      ];
      expect(comparisonPropertyLabel(path, t)).toBe(t("comparison.dependencyTargetIdentity"));
      expect(comparisonValueLabel(uncertain, t, path)).toBe(
        t("comparison.dependencyUnidentifiedTargets", { count: 2 }),
      );
      const localizedLabels: ComparisonReportLabels = {
        ...labels,
        status: (value) => t(`comparison.status.${value}`),
        propertyName: (propertyPath) => comparisonPropertyLabel(propertyPath, t),
        propertyValue: (value, propertyPath) => comparisonValueLabel(value, t, propertyPath),
      };
      for (const reportLabels of [labels, localizedLabels]) {
        const html = buildComparisonReport(comparison, [item], [], reportLabels, locale);
        expect(html).toContain("knownReferences");
        expect(html).not.toContain("PRIVATE_");
      }
      const localizedHtml = buildComparisonReport(comparison, [item], [], localizedLabels, locale);
      expect(localizedHtml).toContain(t("comparison.dependencyTargetIdentity"));
      expect(localizedHtml).toContain(t("comparison.dependencyUnidentifiedTargets", { count: 2 }));
      expect(localizedHtml).toContain("2026-10-23T10:00:00Z");
      expect(localizedHtml).not.toContain("targetIdentity");
    },
  );

  it.each(["en", "es"] as const)(
    "uses localized diagram titles without revealing snapshot database names in %s",
    (locale) => {
      const { t } = createCatalogTranslator(messageCatalogs[locale], locale);
      const comparison = comparisonFixture();
      const input = { path: "PRIVATE_PATH", document: comparisonDocumentFixture() };
      input.document.project.snapshot.databaseName = "PRIVATE_DATABASE_NAME_SENTINEL";
      input.document.project.connection.database = "PRIVATE_CONNECTION_DATABASE_SENTINEL";
      const diagrams = (["reference", "compared"] as const).map((side) => {
        const title = `${t("comparison.context")} · ${t(`comparison.${side}`)}`;
        const svg = comparisonContextSvg(
          input,
          comparison.items.map((item) => item.object),
          { view: t("entity.view"), triggers: () => "" },
          "light",
          title,
        );
        expect(svg).not.toBeNull();
        expect(svg).toContain(`<title>${title}</title>`);
        return { side, svg: svg ?? "" };
      });
      const html = buildComparisonReport(comparison, comparison.items, diagrams, labels, locale);
      expect(html).toContain("Orders");
      expect(html).not.toContain("PRIVATE_");
    },
  );

  it.each(["en", "es"] as const)(
    "omits a native trigger's private function reference from the scoped review in %s",
    (locale) => {
      const { t } = createCatalogTranslator(messageCatalogs[locale], locale);
      const comparison = comparisonFixture();
      const item = comparison.items[0];
      if (item === undefined) throw new Error("fixture item expected");
      item.object.kind = "trigger";
      item.object.memberName = "OrderAudit";
      const privateFunction = {
        kind: "routine",
        name: { schema: "PRIVATE_FUNCTION_SCHEMA_SENTINEL", name: "OFF_DIAGRAM_FUNCTION_SENTINEL" },
        identityArguments: [
          { schema: "PRIVATE_ARGUMENT_SCHEMA_SENTINEL", name: "PRIVATE_ARGUMENT_NAME_SENTINEL" },
        ],
      };
      item.properties = [
        {
          path: ["postgresql", "trigger", "function"],
          result: "different",
          reference: { observation: item.reference, value: JSON.stringify(privateFunction) },
          compared: { observation: item.compared, value: "null" },
        },
        {
          path: ["postgresql", "trigger", "level"],
          result: "different",
          reference: { observation: item.reference, value: '"row"' },
          compared: { observation: item.compared, value: '"statement"' },
        },
      ];
      const html = buildComparisonReport(
        comparison,
        [item],
        [],
        {
          ...labels,
          propertyName: (path) => comparisonPropertyLabel(path, t),
          propertyValue: (value, path) => comparisonValueLabel(value, t, path),
        },
        locale,
      );
      expect(html).toContain("OrderAudit");
      expect(html).toContain("statement");
      expect(html).not.toContain("OFF_DIAGRAM_FUNCTION_SENTINEL");
      expect(html).not.toContain("PRIVATE_");
    },
  );

  it.each(["en", "es"] as const)(
    "presents localized capture context without raw JSON or excluded scope names in %s",
    (locale) => {
      const translator = createCatalogTranslator(messageCatalogs[locale], locale);
      const { t, tCount } = translator;
      const comparison = comparisonFixture();
      comparison.reference = {
        ...comparison.reference,
        provider: "postgreSql",
        accessLevel: "partial",
        hasUnknownExtensions: true,
        scope: {
          schemas: ["sales", "EXCLUDED_SCOPE_SENTINEL", "ANOTHER_EXCLUDED_SCOPE_SENTINEL"],
          includeViews: true,
          includeProgrammability: true,
          includeModuleDefinitions: false,
        },
      };
      Object.assign(comparison.reference, {
        connection: { host: "PRIVATE_HEADER_HOST_SENTINEL" },
        families: { objects: ["PRIVATE_HEADER_OBJECT_SENTINEL"] },
        definition: "PRIVATE_HEADER_SQL_SENTINEL",
      });
      Object.assign(comparison.reference.scope ?? {}, {
        future: "PRIVATE_SCOPE_EXTENSION_SENTINEL",
      });
      comparison.compared = { ...comparison.compared, scope: null, accessLevel: null };
      const html = buildComparisonReport(comparison, comparison.items, [], labels, locale);
      expect(html).toContain('<dl class="capture-facts">');
      expect(html).toContain(`<dt>${t("connection.field.provider")}</dt><dd>PostgreSQL</dd>`);
      expect(html).toContain(t("comparison.capture.access.partial"));
      expect(html).toContain(`sales · ${tCount("comparison.capture.otherSchemas", 2)}`);
      expect(html).toContain(
        `<dt>${t("comparison.capture.definitionsRead")}</dt><dd>${t("review.value.no")}</dd>`,
      );
      expect(html).toContain(t("comparison.capture.unknownExtensions"));
      expect(html).toContain(t("comparison.status.notRecorded"));
      for (const implementationKey of [
        "includeModuleDefinitions",
        "accessLevel",
        "hasUnknownExtensions",
        "extractedAt",
        "&quot;provider&quot;",
        "<pre>",
      ])
        expect(html).not.toContain(implementationKey);
      for (const privateValue of [
        "EXCLUDED_SCOPE_SENTINEL",
        "ANOTHER_EXCLUDED_SCOPE_SENTINEL",
        "PRIVATE_HEADER_HOST_SENTINEL",
        "PRIVATE_HEADER_OBJECT_SENTINEL",
        "PRIVATE_HEADER_SQL_SENTINEL",
        "PRIVATE_SCOPE_EXTENSION_SENTINEL",
      ])
        expect(html).not.toContain(privateValue);
    },
  );

  it.each(["en", "es"] as const)(
    "retains unknown flags and explains a wholly omitted named scope in %s",
    (locale) => {
      const translator = createCatalogTranslator(messageCatalogs[locale], locale);
      const { t, tCount } = translator;
      const capture = {
        ...comparisonFixture().reference,
        scope: { schemas: ["EXCLUDED_ONLY_SCOPE_SENTINEL"], includeViews: false },
      };
      const projected = projectReportCapture(capture, new Set());
      expect(JSON.stringify(projected)).not.toContain("EXCLUDED_ONLY_SCOPE_SENTINEL");
      const fields = new Map(
        reportCaptureFields(projected, translator).map((field) => [field.label, field.value]),
      );
      expect(fields.get(t("comparison.capture.schemas"))).toBe(
        `${t("comparison.capture.noIncludedSchemas")} · ${tCount("comparison.capture.otherSchemas", 1)}`,
      );
      expect(fields.get(t("comparison.capture.views"))).toBe(t("review.value.no"));
      expect(fields.get(t("comparison.capture.modulesRead"))).toBe(
        t("comparison.status.notRecorded"),
      );
      expect(fields.get(t("comparison.capture.definitionsRead"))).toBe(
        t("comparison.status.notRecorded"),
      );
      expect(fields.get(t("comparison.capture.access"))).toBe(t("comparison.status.notRecorded"));
      const allSchemas = projectReportCapture(
        { ...capture, scope: { schemas: [], includeViews: true } },
        new Set(["sales"]),
      );
      expect(
        reportCaptureFields(allSchemas, translator).find(
          (field) => field.label === t("comparison.capture.schemas"),
        )?.value,
      ).toBe(t("comparison.capture.allSchemas"));
    },
  );

  it.each(["en", "es"] as const)(
    "exports localized routine tracking evidence without source or unknown fields in %s",
    (locale) => {
      const { t } = createCatalogTranslator(messageCatalogs[locale], locale);
      const comparison = comparisonFixture();
      const item = comparison.items[0];
      if (item === undefined) throw new Error("fixture item expected");
      item.object.kind = "routine";
      item.properties = [
        {
          path: ["postgresql", "routine", "routineBodyTracking"],
          result: "different",
          reference: { observation: item.reference, value: '"signatureOnly"' },
          compared: { observation: item.compared, value: '"parsedSqlBody"' },
        },
        {
          path: ["postgresql", "routine", "futureSource"],
          result: "different",
          reference: { observation: item.reference, value: "PRIVATE_BODY_SENTINEL" },
          compared: { observation: item.compared, value: "PRIVATE_EXTENSION_SENTINEL" },
        },
      ];
      const html = buildComparisonReport(
        comparison,
        [item],
        [],
        {
          ...labels,
          propertyName: (path) => comparisonPropertyLabel(path, t),
          propertyValue: (value, path) => comparisonValueLabel(value, t, path),
        },
        locale,
      );
      expect(html).toContain(t("comparison.routineBodyTracking"));
      expect(html).toContain(t("module.native.tracking.signatureOnly"));
      expect(html).toContain(t("module.native.tracking.parsedSqlBody"));
      expect(html).not.toContain("PRIVATE_BODY_SENTINEL");
      expect(html).not.toContain("PRIVATE_EXTENSION_SENTINEL");
      expect(
        comparisonValueLabel({ observation: item.reference, value: '"signatureOnly"' }, t, [
          "defaultExpression",
        ]),
      ).toBe("signatureOnly");
      expect(
        comparisonValueLabel(
          { observation: { status: "notRecorded", readAt: null }, value: null },
          t,
          ["postgresql", "routine", "routineBodyTracking"],
        ),
      ).toBe(t("comparison.status.notRecorded"));
    },
  );
  it("keeps a diagram's side explicit when only one side has contextual objects", () => {
    const comparison = comparisonFixture();
    for (const side of ["reference", "compared"] as const) {
      const html = buildComparisonReport(
        comparison,
        comparison.items,
        [{ side, svg: "<svg><title>SELECTED_CONTEXT</title></svg>" }],
        labels,
        "en",
      );
      expect(html).toContain(
        `<section aria-label="${labels[side]}"><h2>${labels[side]}</h2><div class="diagram"><svg><title>SELECTED_CONTEXT</title>`,
      );
      expect(html.match(/class="diagram"/gu)).toHaveLength(1);
    }
  });

  it("exports only declared filtered results and explicit fields, escaping hostile text", () => {
    const comparison = comparisonFixture();
    const selected = comparison.items[0];
    if (!selected) throw new Error("missing fixture");
    selected.object.name.name = "Orders</summary><img src=x onerror=alert(1)>";
    const excluded = comparisonItemFixture();
    excluded.object.name.name = "EXCLUDED_RESULT_SENTINEL";
    comparison.items.push(excluded);
    Object.assign(comparison, {
      source: "MODULE_BODY_SENTINEL",
      connection: { host: "SERVER_SENTINEL" },
      path: "PATH_SENTINEL",
      annotations: "NOTE_SENTINEL",
    });
    Object.assign(comparison.reference, { probe: { login: "LOGIN_SENTINEL" } });
    Object.assign(selected, { source: "OBJECT_EXTENSION_SENTINEL" });
    selected.properties.push({
      path: ["moduleBody"],
      result: "different",
      reference: { observation: selected.reference, value: "MODULE_PROPERTY_SENTINEL" },
      compared: { observation: selected.compared, value: "MODULE_PROPERTY_SENTINEL_2" },
    });
    const html = buildComparisonReport(comparison, [selected], [], labels, "en");
    for (const sentinel of [
      "EXCLUDED_RESULT_SENTINEL",
      "MODULE_BODY_SENTINEL",
      "SERVER_SENTINEL",
      "LOGIN_SENTINEL",
      "PATH_SENTINEL",
      "NOTE_SENTINEL",
      "OBJECT_EXTENSION_SENTINEL",
      "MODULE_PROPERTY_SENTINEL",
    ])
      expect(html).not.toContain(sentinel);
    expect(html).toContain("Orders&lt;/summary&gt;&lt;img");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("nullability");
    expect(html).toContain("default-src 'none'");
  });

  it("scopes diagram data separately and never adds routine/trigger parents or neighbors", () => {
    const input = { path: "PRIVATE_PATH", document: comparisonDocumentFixture() };
    const selected = comparisonItemFixture().object;
    const outside = {
      ...input.document.project.snapshot.tables[0],
      name: { schema: "secret", name: "OUTSIDE_DIAGRAM_SENTINEL" },
      columns: [],
      primaryKey: null,
      indexes: [],
      checkConstraints: [],
    };
    input.document.project.snapshot.tables.push(outside);
    input.document.project.canvas.nodes.push({
      name: outside.name,
      position: { x: 300, y: 0 },
      isCollapsed: false,
      isHidden: false,
    });
    const svg = comparisonContextSvg(
      input,
      [selected],
      { view: "View", triggers: () => "Trigger" },
      "light",
      "Reference diagram context",
    );
    expect(svg).toContain("Orders");
    expect(svg).not.toContain("OUTSIDE_DIAGRAM_SENTINEL");
    expect(svg).not.toContain("PRIVATE_");
    expect(
      comparisonContextSvg(
        input,
        [{ ...selected, kind: "routine" }],
        { view: "View", triggers: () => "Trigger" },
        "light",
        "Reference diagram context",
      ),
    ).toBeNull();
    expect(
      comparisonContextSvg(
        input,
        [{ ...selected, kind: "trigger", memberName: "Audit" }],
        { view: "View", triggers: () => "Trigger" },
        "light",
        "Reference diagram context",
      ),
    ).toBeNull();
  });

  it("uses exact overload identity and excludes source outside the selected routine", () => {
    const input = comparisonDocumentFixture().project.snapshot;
    input.programmability = {
      capture: { objects: { status: "read" }, definitions: { status: "read" } },
      views: [],
      triggers: [],
      routines: [
        {
          name: { schema: "public", name: "amount" },
          identityArguments: [],
          kind: "scalarFunction",
          body: {
            language: "postgreSql",
            name: "sql",
            definition: { status: "readable", text: "ZERO_ARGUMENT_SOURCE" },
          },
          parameters: [],
          returns: null,
          columns: [],
        },
        {
          name: { schema: "public", name: "amount" },
          identityArguments: [{ schema: "pg_catalog", name: "int4" }],
          kind: "scalarFunction",
          body: {
            language: "postgreSql",
            name: "sql",
            definition: { status: "readable", text: "INTEGER_ARGUMENT_SOURCE" },
          },
          parameters: [],
          returns: null,
          columns: [],
        },
      ],
    };
    const object = {
      kind: "routine" as const,
      name: { schema: "public", name: "amount" },
      memberName: null,
      identityArguments: [],
    };
    expect(comparisonDefinition(input, object)).toEqual({
      status: "readable",
      text: "ZERO_ARGUMENT_SOURCE",
    });
    expect(
      comparisonDefinition(input, {
        ...object,
        identityArguments: [{ schema: "pg_catalog", name: "int4" }],
      }),
    ).toEqual({ status: "readable", text: "INTEGER_ARGUMENT_SOURCE" });
  });

  it("filters on literal structured object labels without changing the inputs", () => {
    const comparison = comparisonFixture();
    const before = structuredClone(comparison);
    expect(
      filteredComparisonItems(comparison.items, {
        query: "ORDERS",
        schema: "sales",
        kind: "table",
        result: "different",
      }),
    ).toHaveLength(1);
    expect(
      filteredComparisonItems(comparison.items, {
        query: "",
        schema: "other",
        kind: "",
        result: "",
      }),
    ).toHaveLength(0);
    expect(comparison).toEqual(before);
  });
});
