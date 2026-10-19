import { describe, expect, it } from "vitest";

import type { Programmability, SchemaSnapshot, Trigger } from "@/shared/contracts";
import { formatDate } from "@/shared/i18n/formatDate";
import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";
import { previewSnapshot } from "@/shared/ipc/previewConnectionBackend";

import { describeObjectDetails } from "./objectDetails";
import type { DetailsScope } from "./objectDetails";
import { presentObjectDetails } from "./objectDetailsView";
import type { DetailsView, SectionView } from "./objectDetailsView";

const PARENT = { schema: "sales", name: "Orders" };
const VIEW = { schema: "sales", name: "RecentOrders" };
const READ_AT = "2026-10-12T08:00:00Z";
const SECRET = "CREATE TRIGGER private_body AS SELECT 'private text';";
const TRIGGER: Trigger = {
  parent: PARENT,
  name: "Audit <&> 中文",
  timing: "after",
  isEnabled: false,
  isNotForReplication: true,
  events: [
    { event: "delete", order: "unspecified" },
    { event: "insert", order: "first" },
    { event: "update", order: "last" },
  ],
  body: { language: "sql", definition: { status: "readable", text: SECRET } },
};

function snapshot(overrides: Partial<Programmability> = {}): SchemaSnapshot {
  return {
    ...previewSnapshot("Shop", "partial"),
    programmability: {
      capture: { objects: { status: "read" }, definitions: { status: "read" } },
      routines: [],
      views: [],
      triggers: [TRIGGER],
      ...overrides,
    },
  };
}

function facts(data: SchemaSnapshot, key: string, overrides: Partial<DetailsScope> = {}) {
  const result = describeObjectDetails(data, key, {
    hiddenKeys: new Set(),
    coverage: data.access?.coverage ?? null,
    carriedOver: data.carriedOver ?? [],
    isSchemaFiltered: false,
    isDiagramOnly: false,
    definitions: "included",
    ...overrides,
  });
  if (result === null) throw new Error(`Missing fixture entity: ${key}`);
  return result;
}

function section<Kind extends SectionView["kind"]>(
  view: DetailsView,
  kind: Kind,
): Extract<SectionView, { kind: Kind }> {
  const found = view.sections.find(
    (item): item is Extract<SectionView, { kind: Kind }> => item.kind === kind,
  );
  if (found === undefined) throw new Error(`Missing section: ${kind}`);
  return found;
}

describe.each(SUPPORTED_LOCALES)("shared trigger details in %s", (locale) => {
  const translator = createCatalogTranslator(messageCatalogs[locale], locale);
  const { t } = translator;
  const present = (data = snapshot(), key = "sales.Orders", scope: Partial<DetailsScope> = {}) =>
    presentObjectDetails(facts(data, key, scope), translator);

  it("puts triggers after CHECKs and presents per-event order without disclosing their code", () => {
    const view = present();
    expect(view.sections.map((item) => item.kind)).toEqual([
      "columns",
      "primaryKey",
      "indexes",
      "checks",
      "triggers",
      "references",
      "referencedBy",
    ]);
    const triggers = section(view, "triggers");
    expect(triggers.completeness).toBe("complete");
    expect(triggers.items).toHaveLength(1);
    expect(triggers.items[0]).toMatchObject({
      name: TRIGGER.name,
      ref: { kind: "trigger", parent: PARENT, name: TRIGGER.name },
      badges: [t("trigger.badge.disabled"), "NOT FOR REPLICATION"],
      hint: null,
      openLabel: t("trigger.open", { name: TRIGGER.name }),
    });
    expect(
      triggers.items[0]?.events.map((event) =>
        event.parts.map((part) => (part.kind === "text" ? part.text : part.value)).join(""),
      ),
    ).toEqual(["INSERT", "UPDATE", "DELETE"].map((event) => t("trigger.event.after", { event })));
    expect(triggers.items[0]?.events.map((event) => event.order)).toEqual([
      t("trigger.order.first", { event: "INSERT" }),
      t("trigger.order.last", { event: "UPDATE" }),
      null,
    ]);
    expect(triggers.notes).toEqual([
      t("trigger.note.order"),
      t("trigger.note.truncate"),
      t("trigger.note.bulk"),
    ]);
    expect(JSON.stringify(facts(snapshot(), "sales.Orders"))).not.toContain(SECRET);
    expect(JSON.stringify(view)).not.toContain(SECRET);
  });

  it("deduplicates exception notes and never says TRUNCATE fires a view trigger", () => {
    const triggers = [TRIGGER, { ...TRIGGER, name: "Second" }];
    expect(section(present(snapshot({ triggers })), "triggers").notes).toHaveLength(3);
    const onView = section(
      present(
        snapshot({ triggers: [{ ...TRIGGER, parent: VIEW, timing: "insteadOf" }] }),
        "sales.RecentOrders",
      ),
      "triggers",
    );
    expect(
      onView.items[0]?.events[0]?.parts
        .map((part) => (part.kind === "text" ? part.text : part.value))
        .join(""),
    ).toBe(t("trigger.event.insteadOf", { event: "INSERT" }));
    expect(onView.notes).toEqual([t("trigger.note.bulk")]);
  });

  it("says None only after a current read, including partial-access and diagram scopes", () => {
    const data = snapshot({ triggers: [] });
    const complete = section(
      present(data, "sales.Orders", { isDiagramOnly: true, definitions: "excluded" }),
      "triggers",
    );
    expect(complete.emptyText).toBe(t("details.empty.triggers"));
    delete data.programmability;
    expect(section(present(data), "triggers").emptyText).toBe(t("details.empty.notRecorded"));
    for (const reason of ["optionOff", "queryFailed", "timedOut", "unknown"] as const) {
      const notRead = snapshot({
        triggers: [],
        capture: { objects: { status: "notRead", reason }, definitions: { status: "unknown" } },
      });
      expect(section(present(notRead), "triggers").emptyText).toBe(t(`trigger.notRead.${reason}`));
    }
  });

  it("dates retained metadata and a parent's omitted exported rows, while text-only retention leaves metadata current", () => {
    const object = { kind: "trigger", parent: PARENT, name: TRIGGER.name } as const;
    const held = snapshot({ carriedOver: [{ object, part: "whole", readAt: READ_AT }] });
    const triggers = section(present(held), "triggers");
    expect(triggers.completeness).toBe("notChecked");
    expect(triggers.items[0]?.hint).toBe(
      t("details.hint.notChecked", { date: formatDate(READ_AT, locale) }),
    );
    expect(triggers.footnote).toBe(
      t("details.empty.notChecked", { date: formatDate(READ_AT, locale) }),
    );
    const omitted = section(
      present(snapshot({ triggers: [] }), "sales.Orders", {
        definitions: "excluded",
        isDiagramOnly: true,
        carriedOver: [{ object: PARENT, fact: { kind: "table" }, readAt: READ_AT }],
      }),
      "triggers",
    );
    expect(omitted.emptyText).toBe(t("trigger.notChecked"));
    expect(omitted.emptyText).not.toContain(formatDate(READ_AT, locale));
    const exportedHeld = section(
      present(held, "sales.Orders", { definitions: "excluded" }),
      "triggers",
    );
    expect(exportedHeld.footnote).toBe(t("trigger.notChecked"));
    expect(exportedHeld.items[0]?.hint).toBe(t("trigger.notChecked"));
    const textOnly = section(
      present(snapshot({ carriedOver: [{ object, part: "definition", readAt: READ_AT }] })),
      "triggers",
    );
    expect(textOnly.completeness).toBe("complete");
    expect(textOnly.items[0]?.hint).toBeNull();
  });

  it("qualifies an unconfirmed nonempty list without claiming that no triggers were recorded", () => {
    const data = snapshot({
      capture: { objects: { status: "unknown" }, definitions: { status: "unknown" } },
    });
    const triggers = section(present(data), "triggers");
    expect(triggers.items).toHaveLength(1);
    expect(triggers.emptyText).toBeNull();
    expect(triggers.footnote).toBe(t("trigger.listUnconfirmed"));
    expect(triggers.footnote).not.toBe(t("details.empty.notRecorded"));
  });

  it("shares view definition metadata while keeping its SQL outside both presentation scopes", () => {
    const data = snapshot({
      views: [
        {
          view: VIEW,
          definition: { status: "readable", text: SECRET },
          hasCheckOption: true,
          isIndexed: true,
        },
      ],
    });
    const desktop = present(data, "sales.RecentOrders");
    const exported = present(data, "sales.RecentOrders", {
      definitions: "excluded",
      isDiagramOnly: true,
    });
    expect(exported.sections.map((item) => item.kind)).toEqual([
      "columns",
      "triggers",
      "viewDefinition",
    ]);
    expect(section(exported, "viewDefinition")).toMatchObject({
      included: false,
      stateLabel: t("details.viewDefinition.notIncluded"),
      explanation: null,
      badges: [
        { label: "WITH CHECK OPTION", hint: t("details.viewDefinition.checkOption") },
        {
          label: t("details.viewDefinition.indexed"),
          hint: t("details.viewDefinition.indexedHint"),
        },
      ],
    });
    expect(section(desktop, "viewDefinition")).toMatchObject({ included: true, stateLabel: null });
    for (const view of [desktop, exported]) expect(JSON.stringify(view)).not.toContain(SECRET);
    delete data.programmability;
    expect(
      section(present(data, "sales.RecentOrders", { definitions: "excluded" }), "viewDefinition"),
    ).toMatchObject({ stateLabel: t("details.viewDefinition.notIncluded"), badges: [] });
  });
});
