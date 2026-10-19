import { describe, expect, it } from "vitest";

import type { Column, Trigger } from "@/shared/contracts";
import { formatDate } from "@/shared/i18n/formatDate";
import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";

import type { ModuleDefinitionFacts, ModuleDetails, ModuleSection } from "./moduleDetails";
import { presentModuleDefinition, presentModuleDetails } from "./moduleDetailsView";
import type { ModuleTranslator, RunsSectionView } from "./moduleDetailsView";

const READ_AT = "2026-10-12T08:00:00Z";
const TYPE = { name: "int", length: null, precision: null, scale: null, userDefinedTypeName: null };
const DEFINITION: ModuleDefinitionFacts = {
  status: "readable",
  text: "SELECT '<img onerror=alert(1)>';\r\n",
  notCheckedSince: null,
  reason: null,
  viewSettings: null,
};
const TRIGGER: Trigger = {
  parent: { schema: "sales", name: "Orders" },
  name: "Audit",
  timing: "after",
  events: [
    { event: "update", order: "last" },
    { event: "insert", order: "first" },
    { event: "delete", order: "unspecified" },
  ],
  isEnabled: true,
  isNotForReplication: false,
  body: { language: "sql", definition: { status: "notVisible" } },
};

function details(
  sections: ModuleSection[],
  kind: ModuleDetails["kind"] = "procedure",
): ModuleDetails {
  return {
    key: "test",
    name: { schema: "sales", name: "Example" },
    kind,
    notCheckedSince: null,
    sections,
  };
}

function runs(
  translator: ModuleTranslator,
  trigger: Trigger = TRIGGER,
  parentKind: "table" | "view" = "table",
): RunsSectionView {
  const view = presentModuleDetails(
    details(
      [
        {
          kind: "runs",
          trigger,
          parent: {
            name: trigger.parent,
            key: "sales.Orders",
            unavailable: null,
            kind: parentKind,
          },
        },
      ],
      "trigger",
    ),
    translator,
  ).sections[0];
  if (view?.kind !== "runs") throw new Error("missing runs section");
  return view;
}

for (const locale of SUPPORTED_LOCALES) {
  const translator = createCatalogTranslator(messageCatalogs[locale], locale);
  const { t } = translator;
  describe(`module presentation (${locale})`, () => {
    it("keeps section order and labels, and presents OUTPUT and READONLY without defaults", () => {
      const view = presentModuleDetails(
        details(
          [
            {
              kind: "parameters",
              items: [
                {
                  name: "@Rows",
                  ordinalPosition: 1,
                  dataType: { ...TYPE, userDefinedTypeName: "sales.OrderRows" },
                  isOutput: true,
                  isReadOnly: true,
                },
              ],
              hasSqlDefaultsNote: true,
            },
            { kind: "returns", scalarType: "decimal(12,2)", columns: null },
            { kind: "definition", definition: DEFINITION },
          ],
          "function",
        ),
        translator,
      );
      expect(view.kindLabel).toBe(locale === "en" ? "Function" : "Función");
      expect(view.sections.map((section) => section.title)).toEqual(
        locale === "en"
          ? ["Parameters", "Returns", "Definition"]
          : ["Parámetros", "Devuelve", "Definición"],
      );
      expect(view.sections[0]).toMatchObject({
        items: [{ name: "@Rows", type: "sales.OrderRows", badges: ["OUTPUT", "READONLY"] }],
        note: t("module.parameters.defaults"),
      });
      expect(view.sections[1]).toMatchObject({ scalarType: "decimal(12,2)", columns: null });
      expect(
        presentModuleDetails(
          details([{ kind: "parameters", items: [], hasSqlDefaultsNote: false }]),
          translator,
        ).sections[0],
      ).toMatchObject({ emptyText: t("module.parameters.empty"), note: null });
    });

    it("reuses the column view for table returns without publishing internal DEFAULT expressions", () => {
      const column: Column = {
        name: "Quantity",
        ordinalPosition: 1,
        dataType: TYPE,
        isNullable: false,
        isIdentity: true,
        isComputed: false,
        defaultExpression: { status: "readable", text: "((4))" },
      };
      const section = presentModuleDetails(
        details([{ kind: "returns", scalarType: null, columns: [column] }], "function"),
        translator,
      ).sections[0];
      expect(section).toMatchObject({
        kind: "returns",
        columns: {
          kind: "columns",
          headers: { nullable: t("module.column.nullable") },
          items: [
            {
              name: "Quantity",
              type: "int",
              nullable: t("module.value.no"),
              badges: [{ kind: "identity", label: "IDENTITY" }],
              defaultValue: null,
            },
          ],
        },
      });
      expect(JSON.stringify(section)).not.toContain("((4))");
      expect(
        presentModuleDetails(
          details([{ kind: "returns", scalarType: null, columns: [] }], "function"),
          translator,
        ).sections[0],
      ).toMatchObject({ emptyText: t("module.returns.notRecorded") });
    });

    it("keeps First and Last attached to their own event and renders statement tokens", () => {
      const section = runs(translator);
      expect(section.events.map((event) => event.order)).toEqual([
        t("trigger.order.first", { event: "INSERT" }),
        t("trigger.order.last", { event: "UPDATE" }),
        null,
      ]);
      expect(section.events[0]?.parts).toContainEqual({
        kind: "parameter",
        name: "event",
        value: "INSERT",
      });
      expect(section.parent).toMatchObject({
        key: "sales.Orders",
        goLabel: t("module.parent.go", { name: "sales.Orders" }),
      });
      expect(section.notes).toEqual([
        t("trigger.note.after"),
        t("trigger.note.order"),
        t("trigger.note.truncate"),
        t("trigger.note.bulk"),
      ]);
    });

    it("shows only the applicable timing, truncate, bulk, disabled and replication notes", () => {
      const section = runs(
        translator,
        {
          ...TRIGGER,
          timing: "insteadOf",
          events: [{ event: "delete", order: "unspecified" }],
          isEnabled: false,
          isNotForReplication: true,
        },
        "view",
      );
      expect(section.notes).toEqual([
        t("trigger.state.disabled"),
        t("trigger.note.insteadOf"),
        t("trigger.note.replication"),
      ]);
      expect(section.badges).toEqual([t("trigger.badge.disabled"), "NOT FOR REPLICATION"]);
      expect(
        runs(translator, { ...TRIGGER, events: [{ event: "update", order: "unspecified" }] }).notes,
      ).not.toContain(t("trigger.note.bulk"));
      const unknown = runs(translator, {
        ...TRIGGER,
        timing: "unknown",
        events: [{ event: "unknown", order: "unknown" }],
      });
      expect(unknown.notes).toEqual([]);
      expect(unknown.events[0]?.order).toBe(t("trigger.order.unknown"));
      expect(runs(translator, { ...TRIGGER, events: [] }).emptyText).toBe(
        t("trigger.events.empty"),
      );
    });

    it("explains every missing definition and offers Why only for permission uncertainty", () => {
      for (const status of ["notVisible", "encrypted", "clr", "notRecorded"] as const) {
        const view = presentModuleDefinition({ ...DEFINITION, status, text: null }, translator);
        expect(view.stateLabel).toBe(t(`module.definition.${status}.title`));
        expect(view.explanation).toBe(t(`module.definition.${status}.body`));
        expect(view.text).toBeNull();
        expect(view.canExplainAccess).toBe(status === "notVisible");
      }
      for (const [reason, key] of [
        ["optionOff", "optionOff"],
        ["queryFailed", "readFailed"],
        ["timedOut", "timedOut"],
        ["unknown", "readFailed"],
      ] as const) {
        expect(
          presentModuleDefinition(
            { ...DEFINITION, status: "notRead", text: null, reason },
            translator,
          ).explanation,
        ).toBe(t(`module.definition.${key}`));
      }
    });

    it("preserves SQL exactly and dates both kept text and kept states", () => {
      const view = presentModuleDefinition({ ...DEFINITION, notCheckedSince: READ_AT }, translator);
      expect(view).toMatchObject({ state: "notChecked", text: DEFINITION.text, explanation: null });
      expect(view.notice).toBe(
        t("module.definition.notChecked", { date: formatDate(READ_AT, locale) }),
      );
      const encrypted = presentModuleDefinition(
        { ...DEFINITION, status: "encrypted", text: null, notCheckedSince: READ_AT },
        translator,
      );
      expect(encrypted.state).toBe("encrypted");
      expect(encrypted.notice).toBe(view.notice);
      const invisible = presentModuleDefinition(
        { ...DEFINITION, status: "notVisible", text: null, notCheckedSince: READ_AT },
        translator,
      );
      expect(invisible.notice).toBe(view.notice);
      expect(invisible.stateLabel).toBe(t("module.definition.keptNotVisible.title"));
      expect(invisible.explanation).toBe(t("module.definition.keptNotVisible.body"));
      expect(invisible.explanation).not.toBe(t("module.definition.notVisible.body"));
      expect(
        presentModuleDetails({ ...details([]), notCheckedSince: READ_AT }, translator).notice,
      ).toBe(t("module.notice.notChecked", { date: formatDate(READ_AT, locale) }));
    });

    it("shows only recorded view settings with their explanations", () => {
      expect(presentModuleDefinition(DEFINITION, translator).badges).toEqual([]);
      expect(
        presentModuleDefinition(
          { ...DEFINITION, viewSettings: { hasCheckOption: true, isIndexed: true } },
          translator,
        ).badges,
      ).toEqual([
        { label: "WITH CHECK OPTION", hint: t("module.view.checkOption") },
        { label: t("module.view.indexed"), hint: t("module.view.indexedHint") },
      ]);
    });
  });
}
