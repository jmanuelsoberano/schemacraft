import { describe, expect, it } from "vitest";

import { formatDate } from "@/shared/i18n/formatDate";
import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";
import { previewSnapshot } from "@/shared/ipc/previewConnectionBackend";

import { describeObjectDetails } from "./objectDetails";
import type {
  ColumnFacts,
  DetailSection,
  DetailSectionKind,
  DetailsScope,
  ListCompleteness,
  ObjectDetails,
  RelationFacts,
} from "./objectDetails";
import { presentObjectDetails } from "./objectDetailsView";
import type { DetailsTranslator, DetailsView, SectionView } from "./objectDetailsView";

// The application's translator, over the whole catalogue, narrows to the one the details need.
const english: DetailsTranslator = createCatalogTranslator(messageCatalogs.en, "en");
const spanish: DetailsTranslator = createCatalogTranslator(messageCatalogs.es, "es");
const READ_AT = "2026-10-12T08:00:00Z";

const COMPLETE: ListCompleteness = { status: "complete" };
const INCOMPLETE: readonly ListCompleteness[] = [
  { status: "notVisible" },
  { status: "notRecorded" },
  { status: "notChecked", readAt: READ_AT },
  { status: "diagram" },
  { status: "inspectedSchemas" },
];

function tableDetails(sections: DetailSection[]): ObjectDetails {
  return {
    key: "sales.Orders",
    name: { schema: "sales", name: "Orders" },
    kind: "table",
    columnCount: 2,
    notCheckedSince: null,
    sections,
  };
}

function column(overrides: Partial<ColumnFacts> = {}): ColumnFacts {
  return {
    name: "CustomerId",
    type: "int",
    isNullable: false,
    isIdentity: false,
    isComputed: false,
    isPrimaryKey: false,
    isForeignKey: false,
    defaultValue: null,
    ...overrides,
  };
}

function relation(overrides: Partial<RelationFacts> = {}): RelationFacts {
  return {
    name: "FK_Orders_Customers",
    columns: [{ referencing: "CustomerId", referenced: "CustomerId" }],
    onDelete: "noAction",
    onUpdate: "noAction",
    isEnabled: true,
    target: {
      status: "available",
      key: "dbo.Customers",
      name: { schema: "dbo", name: "Customers" },
    },
    notCheckedSince: null,
    ...overrides,
  };
}

function sectionOf<Kind extends DetailSectionKind>(
  view: DetailsView,
  kind: Kind,
): Extract<SectionView, { kind: Kind }> {
  const section = view.sections.find(
    (candidate): candidate is Extract<SectionView, { kind: Kind }> => candidate.kind === kind,
  );
  if (section === undefined) {
    throw new Error(`${view.key} has no ${kind} section`);
  }
  return section;
}

/** One relation item, presented alone. */
function presentRelation(
  facts: RelationFacts,
  t: DetailsTranslator,
  kind: "references" | "referencedBy" = "references",
) {
  const view = presentObjectDetails(
    tableDetails([{ kind, items: [facts], completeness: COMPLETE }]),
    t,
  );
  const item = sectionOf(view, kind).items[0];
  if (item === undefined) {
    throw new Error("the relation was not presented");
  }
  return item;
}

/** One column item, presented alone. */
function presentColumn(facts: ColumnFacts, t: DetailsTranslator) {
  const view = presentObjectDetails(
    tableDetails([{ kind: "columns", items: [facts], completeness: COMPLETE }]),
    t,
  );
  const item = sectionOf(view, "columns").items[0];
  if (item === undefined) {
    throw new Error("the column was not presented");
  }
  return item;
}

describe.each(SUPPORTED_LOCALES)("presentObjectDetails in %s", (locale) => {
  const t = locale === "en" ? english : spanish;
  const catalog = messageCatalogs[locale];

  it("says None only for a complete list, and otherwise what the list may be missing", () => {
    const empty = (completeness: ListCompleteness) =>
      presentObjectDetails(
        tableDetails([
          { kind: "indexes", items: [], completeness },
          { kind: "referencedBy", items: [], completeness },
        ]),
        t,
      );

    const complete = empty(COMPLETE);
    expect(sectionOf(complete, "indexes").emptyText).toBe(catalog["details.empty.indexes"]);
    expect(sectionOf(complete, "referencedBy").emptyText).toBe(
      catalog["details.empty.referencedBy"],
    );

    const expected: Record<ListCompleteness["status"], string> = {
      complete: catalog["details.empty.indexes"],
      notVisible: catalog["details.empty.notVisible"],
      notRecorded: catalog["details.empty.notRecorded"],
      notChecked: catalog["details.empty.notChecked"].replace(
        "{date}",
        formatDate(READ_AT, locale),
      ),
      diagram: catalog["details.empty.diagram"],
      inspectedSchemas: catalog["details.empty.inspectedSchemas"],
    };
    for (const completeness of INCOMPLETE) {
      const view = empty(completeness);
      for (const kind of ["indexes", "referencedBy"] as const) {
        const section = sectionOf(view, kind);
        expect(section.emptyText, completeness.status).toBe(expected[completeness.status]);
        expect(section.emptyText, completeness.status).not.toBe(catalog[`details.empty.${kind}`]);
        // A renderer with somewhere to send the reader still knows why the list is short.
        expect(section.completeness).toBe(completeness.status);
      }
    }
    expect(sectionOf(complete, "indexes").completeness).toBe("complete");
  });

  it("footnotes only a referenced-by list with items that the login may not see in full", () => {
    const presented = (kind: "references" | "referencedBy", completeness: ListCompleteness) =>
      sectionOf(
        presentObjectDetails(tableDetails([{ kind, items: [relation()], completeness }]), t),
        kind,
      );
    expect(presented("referencedBy", { status: "notVisible" })).toMatchObject({
      count: 1,
      emptyText: null,
      footnote: catalog["details.footnote.notVisible"],
    });
    expect(presented("referencedBy", COMPLETE).footnote).toBeNull();
    expect(presented("referencedBy", { status: "diagram" }).footnote).toBeNull();
    expect(presented("references", { status: "notVisible" }).footnote).toBeNull();
    // An empty list says it in its one line instead.
    const empty = sectionOf(
      presentObjectDetails(
        tableDetails([{ kind: "referencedBy", items: [], completeness: { status: "notVisible" } }]),
        t,
      ),
      "referencedBy",
    );
    expect(empty.footnote).toBeNull();
    expect(empty.emptyText).toBe(catalog["details.empty.notVisible"]);
  });

  it("writes the referential actions only when they do something", () => {
    expect(presentRelation(relation(), t).actions).toEqual([]);
    expect(
      presentRelation(relation({ onDelete: "cascade", onUpdate: "setNull" }), t).actions,
    ).toEqual([
      catalog["details.relation.onDelete"].replace(
        "{action}",
        catalog["referentialAction.cascade"],
      ),
      catalog["details.relation.onUpdate"].replace(
        "{action}",
        catalog["referentialAction.setNull"],
      ),
    ]);
    expect(presentRelation(relation({ isEnabled: false }), t).badges).toEqual([
      { kind: "disabled", label: catalog["details.badge.disabled"] },
    ]);
    expect(presentRelation(relation({ notCheckedSince: READ_AT }), t).hint).toBe(
      catalog["details.hint.notChecked"].replace("{date}", formatDate(READ_AT, locale)),
    );
  });

  it("links a target only when it is on the canvas", () => {
    expect(presentRelation(relation(), t).target).toEqual({
      state: "available",
      label: "dbo.Customers",
      stateLabel: null,
      key: "dbo.Customers",
      goLabel: catalog["details.target.go"].replace("{name}", "dbo.Customers"),
    });
    const name = { schema: "sales", name: "Orders" };
    expect(
      presentRelation(relation({ target: { status: "self", key: "sales.Orders", name } }), t)
        .target,
    ).toEqual({
      state: "self",
      label: "sales.Orders",
      stateLabel: catalog["details.target.self"],
      key: null,
      goLabel: null,
    });
    expect(
      presentRelation(relation({ target: { status: "hidden", key: "sales.Orders", name } }), t)
        .target,
    ).toMatchObject({ state: "hidden", stateLabel: catalog["details.target.hidden"], key: null });
    expect(
      presentRelation(relation({ target: { status: "unknown", key: "sales.Orders", name } }), t)
        .target,
    ).toMatchObject({ state: "unknown", stateLabel: catalog["details.target.unknown"], key: null });

    const invisible = presentRelation(
      relation({
        columns: [{ referencing: "RegionId", referenced: null }],
        target: { status: "notVisible" },
      }),
      t,
    );
    expect(invisible.target).toEqual({
      state: "notVisible",
      label: catalog["details.target.notVisible"],
      stateLabel: null,
      key: null,
      goLabel: null,
    });
    expect(invisible.columns).toEqual(["RegionId"]);
    expect(presentRelation(relation(), t).columns).toEqual(["CustomerId → CustomerId"]);
  });

  it("marks a default or a CHECK whose text is missing, with the reason as a hint", () => {
    const defaultOf = (value: ColumnFacts["defaultValue"]) =>
      presentColumn(column({ defaultValue: value }), t).defaultValue;
    expect(defaultOf(null)).toBeNull();
    expect(defaultOf({ status: "readable", text: "(getdate())" })).toEqual({
      state: "readable",
      text: catalog["details.default"].replace("{expression}", "(getdate())"),
      hint: null,
    });
    expect(defaultOf({ status: "notAvailable" })).toEqual({
      state: "notAvailable",
      text: catalog["definition.default.notAvailable"],
      hint: catalog["details.hint.notAvailable"],
    });
    expect(defaultOf({ status: "notRecorded" })).toEqual({
      state: "notRecorded",
      text: catalog["definition.default.notRecorded"],
      hint: catalog["details.hint.notRecorded"],
    });
    expect(defaultOf({ status: "notChecked", text: "(getdate())", readAt: READ_AT })).toEqual({
      state: "notChecked",
      text: catalog["details.default"].replace("{expression}", "(getdate())"),
      hint: catalog["details.hint.notChecked"].replace("{date}", formatDate(READ_AT, locale)),
    });

    const checks = sectionOf(
      presentObjectDetails(
        tableDetails([
          {
            kind: "checks",
            items: [
              {
                name: "CK_Quantity",
                expression: { status: "readable", text: "([Quantity]>(0))" },
                isEnabled: true,
              },
              { name: "CK_Email", expression: { status: "notAvailable" }, isEnabled: false },
              { name: "CK_Status", expression: { status: "notRecorded" }, isEnabled: null },
            ],
            completeness: COMPLETE,
          },
        ]),
        t,
      ),
      "checks",
    );
    expect(checks.items).toEqual([
      {
        name: "CK_Quantity",
        columns: [],
        badges: [],
        expression: { state: "readable", text: "([Quantity]>(0))", hint: null },
      },
      {
        name: "CK_Email",
        columns: [],
        badges: [{ kind: "disabled", label: catalog["details.badge.disabled"] }],
        expression: {
          state: "notAvailable",
          text: catalog["definition.notAvailable"],
          hint: catalog["details.hint.notAvailable"],
        },
      },
      {
        name: "CK_Status",
        columns: [],
        badges: [],
        expression: {
          state: "notRecorded",
          text: catalog["definition.notRecorded"],
          hint: catalog["details.hint.notRecorded"],
        },
      },
    ]);
  });

  it("badges the columns, the keys and the indexes", () => {
    const flagged = presentColumn(
      column({ isPrimaryKey: true, isForeignKey: true, isIdentity: true, isComputed: true }),
      t,
    );
    expect(flagged.badges).toEqual([
      { kind: "primaryKey", label: catalog["details.badge.primaryKey"] },
      { kind: "foreignKey", label: catalog["details.badge.foreignKey"] },
      { kind: "identity", label: catalog["details.badge.identity"] },
      { kind: "computed", label: catalog["details.badge.computed"] },
    ]);
    expect(presentColumn(column(), t).badges).toEqual([]);
    expect(presentColumn(column({ isNullable: true }), t).nullable).toBe(
      catalog["details.value.yes"],
    );
    expect(presentColumn(column(), t).nullable).toBe(catalog["details.value.no"]);

    const view = presentObjectDetails(
      tableDetails([
        {
          kind: "primaryKey",
          items: [{ name: "PK_Orders", columns: ["OrderId", "LineNumber"], isClustered: true }],
          completeness: COMPLETE,
        },
        {
          kind: "indexes",
          items: [
            { name: "UX_Email", columns: ["Email"], kind: "uniqueIndex", isClustered: false },
            { name: "UQ_Code", columns: ["Code"], kind: "uniqueConstraint", isClustered: true },
            { name: "IX_Name", columns: ["Name"], kind: "nonUnique", isClustered: false },
          ],
          completeness: COMPLETE,
        },
      ]),
      t,
    );
    expect(sectionOf(view, "primaryKey").items).toEqual([
      {
        name: "PK_Orders",
        columns: ["OrderId", "LineNumber"],
        badges: [{ kind: "clustered", label: catalog["indexKind.clustered"] }],
        expression: null,
      },
    ]);
    expect(sectionOf(view, "indexes").items.map((index) => index.badges)).toEqual([
      [{ kind: "unique", label: catalog["indexKind.uniqueIndex"] }],
      [
        { kind: "unique", label: catalog["indexKind.uniqueConstraint"] },
        { kind: "clustered", label: catalog["indexKind.clustered"] },
      ],
      [],
    ]);
  });
});

describe("a table of the preview fixture, read with partial access", () => {
  const partial = previewSnapshot("Shop", "partial");
  const scope: DetailsScope = {
    hiddenKeys: new Set(),
    coverage: partial.access?.coverage ?? null,
    carriedOver: [],
    isSchemaFiltered: false,
    isDiagramOnly: false,
  };
  const orders = describeObjectDetails(partial, "sales.Orders", scope);
  const recentOrders = describeObjectDetails(partial, "sales.RecentOrders", scope);
  if (orders === null || recentOrders === null) {
    throw new Error("the fixture changed");
  }

  it("reads in English", () => {
    const view = presentObjectDetails(orders, english);
    expect(view).toMatchObject({
      key: "sales.Orders",
      kind: "table",
      kindLabel: "Table",
      schema: "sales",
      name: "Orders",
      summary: "5 columns",
      notice: null,
    });
    expect(view.sections.map((section) => [section.title, section.count])).toEqual([
      ["Columns", 5],
      ["Primary key", 1],
      ["Indexes", 1],
      ["Check constraints", 1],
      ["References", 2],
      ["Referenced by", 1],
    ]);
    const columns = sectionOf(view, "columns");
    expect(columns.headers).toEqual({ name: "Column", type: "Type", nullable: "Nullable" });
    expect(columns.items[0]).toEqual({
      name: "OrderId",
      type: "int",
      isNullable: false,
      nullable: "No",
      badges: [
        { kind: "primaryKey", label: "PK" },
        { kind: "identity", label: "identity" },
      ],
      defaultValue: null,
    });
    expect(columns.items[3]).toMatchObject({
      name: "PlacedAt",
      type: "datetime2(7)",
      defaultValue: {
        state: "notAvailable",
        text: "DEFAULT (not available)",
        hint: "The text isn't visible to this login.",
      },
    });
    expect(sectionOf(view, "checks").items[0]).toMatchObject({
      name: "CK_Orders_Status",
      expression: { state: "notAvailable", text: "not available" },
    });
    const references = sectionOf(view, "references");
    expect(references.items.map((item) => [item.name, item.target.label, item.target.key])).toEqual(
      [
        ["FK_Orders_SalesRep", "hr.Employees", "hr.Employees"],
        ["FK_Orders_Customers", "A table not visible to this login", null],
      ],
    );
    expect(references.items[0]).toMatchObject({
      columns: ["SalesRepId → EmployeeId"],
      actions: ["On delete: set null"],
      target: { goLabel: "Go to hr.Employees" },
    });
    expect(references.items[1]).toMatchObject({
      columns: ["CustomerId"],
      actions: ["On update: cascade"],
    });
    const referencedBy = sectionOf(view, "referencedBy");
    expect(referencedBy.items.map((item) => item.name)).toEqual(["FK_OrderLines_Orders"]);
    expect(referencedBy.footnote).toBe(
      "Other tables that aren't visible to this login may reference it.",
    );

    expect(presentObjectDetails(recentOrders, english)).toMatchObject({
      kind: "view",
      kindLabel: "View",
      summary: "2 columns",
    });
    expect(presentObjectDetails(recentOrders, english).sections).toHaveLength(1);
  });

  it("reads in Spanish", () => {
    const view = presentObjectDetails(orders, spanish);
    expect(view).toMatchObject({ kindLabel: "Tabla", summary: "5 columnas" });
    expect(view.sections.map((section) => section.title)).toEqual([
      "Columnas",
      "Clave primaria",
      "Índices",
      "Restricciones CHECK",
      "Referencia a",
      "Referenciada por",
    ]);
    const columns = sectionOf(view, "columns");
    expect(columns.headers).toEqual({ name: "Columna", type: "Tipo", nullable: "Admite NULL" });
    expect(columns.items.map((item) => item.nullable)).toEqual(["No", "No", "Sí", "No", "No"]);
    expect(columns.items[3]?.defaultValue).toEqual({
      state: "notAvailable",
      text: "DEFAULT (no disponible)",
      hint: "El texto no es visible para este inicio de sesión.",
    });
    const references = sectionOf(view, "references");
    expect(references.items[0]).toMatchObject({
      actions: ["Al eliminar: poner a null"],
      target: { goLabel: "Ir a hr.Employees" },
    });
    expect(references.items[1]?.target.label).toBe(
      "Una tabla no visible para este inicio de sesión",
    );
    expect(sectionOf(view, "referencedBy").footnote).toBe(
      "Puede haber otras tablas no visibles para este inicio de sesión que hagan referencia a ella.",
    );
    expect(presentObjectDetails(recentOrders, spanish)).toMatchObject({
      kindLabel: "Vista",
      summary: "2 columnas",
    });
  });

  it("notices an object kept whole from an earlier read", () => {
    const kept = describeObjectDetails(partial, "sales.Orders", {
      ...scope,
      carriedOver: [
        { object: { schema: "sales", name: "Orders" }, fact: { kind: "table" }, readAt: READ_AT },
      ],
    });
    if (kept === null) {
      throw new Error("the fixture changed");
    }
    const date = formatDate(READ_AT, "en");
    const view = presentObjectDetails(kept, english);
    expect(view.notice).toBe(`Kept from a read on ${date}: this login couldn't check it.`);
    expect(sectionOf(view, "indexes").emptyText).toBeNull();
    expect(
      presentObjectDetails(
        { ...kept, sections: kept.sections.map((section) => ({ ...section, items: [] })) },
        english,
      ).sections.map((section) => section.emptyText),
    ).toEqual(Array.from({ length: 6 }, () => `Not checked since ${date}`));
  });
});
