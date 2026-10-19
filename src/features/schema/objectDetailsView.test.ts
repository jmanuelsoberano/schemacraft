import { describe, expect, it } from "vitest";

import type { CheckConstraint, Column, ForeignKey } from "@/shared/contracts";
import { formatDate } from "@/shared/i18n/formatDate";
import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";
import { previewSnapshot } from "@/shared/ipc/previewConnectionBackend";

import { definitionText, isUnknownDefinition } from "./definition";
import { describeObjectDetails } from "./objectDetails";
import type {
  CheckFacts,
  ColumnFacts,
  DetailSection,
  DetailSectionKind,
  DetailsScope,
  IndexFacts,
  ListCompleteness,
  ObjectDetails,
  RelationFacts,
} from "./objectDetails";
import { hasRuleTargets, presentObjectDetails } from "./objectDetailsView";
import type {
  DetailsTranslator,
  DetailsView,
  RuleNodeView,
  SectionView,
} from "./objectDetailsView";
import { readCheckConstraint } from "./rules/checkReader";
import { explainForeignKey, explainForeignKeyToInvisibleTable } from "./rules/foreignKeyReader";
import { ruleTextToString } from "./rules/ruleText";

// The application's translator, over the whole catalogue, narrows to the one the details need.
const english: DetailsTranslator = createCatalogTranslator(messageCatalogs.en, "en");
const spanish: DetailsTranslator = createCatalogTranslator(messageCatalogs.es, "es");
const READ_AT = "2026-10-12T08:00:00Z";
const SHOP = previewSnapshot("Shop", "full");

/** A key of sales.Orders to dbo.Customers, the tables of the preview fixture. */
function ordersCustomers(overrides: Partial<ForeignKey> = {}): ForeignKey {
  return {
    name: "FK_Orders_Customers",
    referencingTable: { schema: "sales", name: "Orders" },
    referencedTable: { schema: "dbo", name: "Customers" },
    columnPairs: [{ referencingColumn: "CustomerId", referencedColumn: "CustomerId" }],
    onDelete: "noAction",
    onUpdate: "noAction",
    isEnabled: true,
    ...overrides,
  };
}

/** The columns of sales.Orders, which the CHECKs below are read against. */
const ORDERS_COLUMNS: readonly Column[] =
  SHOP.tables.find((table) => table.name.name === "Orders")?.columns ?? [];

/** The facts of a `CHECK` of sales.Orders, read as the details read it. */
function check(
  name: string,
  expression: CheckConstraint["expression"],
  isEnabled: boolean | null,
  isTrusted: boolean | null = null,
): CheckFacts {
  const text = definitionText(expression);
  return {
    name,
    expression:
      text === null
        ? { status: isUnknownDefinition(expression) ? "notRecorded" : "notAvailable" }
        : { status: "readable", text },
    isEnabled,
    isTrusted,
    reading: readCheckConstraint(
      { name, expression, isEnabled, ...(isTrusted === null ? {} : { isTrusted }) },
      ORDERS_COLUMNS,
      { schema: "sales", name: "Orders" },
    ),
  };
}

/** Sentences as plain lines, a group's items indented under its heading. */
function lines(nodes: readonly RuleNodeView[], depth = 0): string[] {
  const indent = "  ".repeat(depth);
  return nodes.flatMap((node) =>
    node.kind === "sentence"
      ? [`${indent}${ruleTextToString(node.parts)}`]
      : [`${indent}${ruleTextToString(node.heading)}`, ...lines(node.items, depth + 1)],
  );
}

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

/** An index whose state, unless given, was not recorded, as in a file saved before 1.2. */
function index(overrides: Partial<IndexFacts> = {}): IndexFacts {
  return {
    name: "IX_Name",
    columns: ["Name"],
    kind: "nonUnique",
    isClustered: false,
    includedColumns: null,
    isFiltered: null,
    isEnabled: null,
    ...overrides,
  };
}

function relation(
  overrides: Partial<RelationFacts> = {},
  key: ForeignKey = ordersCustomers(),
): RelationFacts {
  return {
    name: key.name,
    columns: [{ referencing: "CustomerId", referenced: "CustomerId" }],
    onDelete: key.onDelete,
    onUpdate: key.onUpdate,
    isEnabled: key.isEnabled,
    isTrusted: key.isTrusted ?? null,
    target: {
      status: "available",
      key: "dbo.Customers",
      name: { schema: "dbo", name: "Customers" },
    },
    notCheckedSince: null,
    explanation: explainForeignKey(key, SHOP),
    relation: "sales.Orders.FK_Orders_Customers",
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
      notRead: catalog["trigger.notRead.queryFailed"],
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

  it("says what a key means and what its actions do, with its scripted SQL and what it involves", () => {
    const facts = relation({}, ordersCustomers({ onDelete: "cascade", onUpdate: "setNull" }));
    const { rule } = presentRelation(facts, t);
    // The sentences are the reader's, in its order, each worded once in the translator's language.
    expect(rule.sentences.map((node) => node.kind)).toEqual(
      facts.explanation.rules.map(() => "sentence"),
    );
    expect(lines(rule.sentences)).toHaveLength(4);
    expect(lines(rule.sentences).at(2)).toContain("dbo.Customers");
    expect(rule).toMatchObject({
      unread: null,
      sql: facts.explanation.sql,
      sqlNote: catalog["rule.fk.sqlNote"],
      targets: {
        columns: new Map([
          ["sales.Orders", ["CustomerId"]],
          ["dbo.Customers", ["CustomerId"]],
        ]),
        relation: "sales.Orders.FK_Orders_Customers",
      },
    });
    expect(hasRuleTargets(rule.targets)).toBe(true);
    expect(presentRelation(relation({ notCheckedSince: READ_AT }), t).hint).toBe(
      catalog["details.hint.notChecked"].replace("{date}", formatDate(READ_AT, locale)),
    );
  });

  it("puts a disabled key's sentences under When enabled, beside its badge", () => {
    const disabled = presentRelation(
      relation({ isEnabled: false }, ordersCustomers({ isEnabled: false })),
      t,
    );
    expect(disabled.badges).toEqual([
      { kind: "disabled", label: catalog["details.badge.disabled"] },
    ]);
    expect(disabled.rule.sentences).toHaveLength(1);
    expect(disabled.rule.sentences[0]).toMatchObject({ kind: "group", group: "whenEnabled" });
    expect(lines(disabled.rule.sentences)[0]).toBe(catalog["rule.whenEnabled"]);
    // A disabled key is never trusted, and only its disabled badge says so.
    expect(
      presentRelation(
        relation({ isEnabled: false, isTrusted: false }, ordersCustomers({ isEnabled: false })),
        t,
      ).badges,
    ).toEqual([{ kind: "disabled", label: catalog["details.badge.disabled"] }]);
  });

  it("badges a key SQL Server marks as not trusted and says so before its sentences", () => {
    const key = ordersCustomers({ isTrusted: false });
    const untrusted = presentRelation(relation({ isTrusted: false }, key), t);
    expect(untrusted.badges).toEqual([
      { kind: "untrusted", label: catalog["details.badge.untrusted"] },
    ]);
    expect(lines(untrusted.rule.sentences).slice(0, 2)).toEqual([
      catalog["rule.trust.notVerified"].replace("{table}", "sales.Orders"),
      catalog["rule.whenWritten.one"].replace("{columns}", "CustomerId"),
    ]);
    expect(untrusted.rule.sentences[1]).toMatchObject({ kind: "group", group: "whenWritten" });
    expect(untrusted.rule.sql?.startsWith("ALTER TABLE [sales].[Orders] WITH NOCHECK ADD")).toBe(
      true,
    );
    expect(presentRelation(relation({ isTrusted: true }), t).badges).toEqual([]);
    expect(presentRelation(relation({ isTrusted: null }), t).badges).toEqual([]);
  });

  it("badges a CHECK SQL Server marks as not trusted and says so before its sentences", () => {
    const [untrusted, trusted, unrecorded] = sectionOf(
      presentObjectDetails(
        tableDetails([
          {
            kind: "checks",
            items: [
              check("CK_A", { status: "readable", text: "([OrderId]>(0))" }, true, false),
              check("CK_B", { status: "readable", text: "([OrderId]>(0))" }, true, true),
              check("CK_C", { status: "readable", text: "([OrderId]>(0))" }, true),
            ],
            completeness: COMPLETE,
          },
        ]),
        t,
      ),
      "checks",
    ).items;
    expect(untrusted?.badges).toEqual([
      { kind: "untrusted", label: catalog["details.badge.untrusted"] },
    ]);
    expect(lines(untrusted?.rule?.sentences ?? [])).toEqual([
      catalog["rule.trust.notVerified"].replace("{table}", "sales.Orders"),
      catalog["rule.whenWritten.one"].replace("{columns}", "OrderId"),
      `  ${catalog["rule.check.gt"].replace("{column}", "OrderId").replace("{value}", "0")}`,
    ]);
    expect(trusted?.badges).toEqual([]);
    expect(unrecorded?.badges).toEqual([]);
    expect(lines(trusted?.rule?.sentences ?? [])).toEqual(lines(unrecorded?.rule?.sentences ?? []));
  });

  it("says a CHECK whose text the login cannot see may not hold for the rows there", () => {
    // Trust needs no VIEW DEFINITION, so the sentence stays when the text is missing.
    const present = (isTrusted: boolean | null) =>
      sectionOf(
        presentObjectDetails(
          tableDetails([
            {
              kind: "checks",
              items: [check("CK_Hidden", { status: "notVisible" }, true, isTrusted)],
              completeness: COMPLETE,
            },
          ]),
          t,
        ),
        "checks",
      );
    const section = present(false);
    const [hidden] = section.items;
    expect(hidden?.badges).toEqual([
      { kind: "untrusted", label: catalog["details.badge.untrusted"] },
    ]);
    expect(hidden?.expression).toMatchObject({
      state: "notAvailable",
      text: catalog["definition.notAvailable"],
    });
    expect(lines(hidden?.rule?.sentences ?? [])).toEqual([
      catalog["rule.trust.notVerified"].replace("{table}", "sales.Orders"),
    ]);
    expect(hidden?.rule).toMatchObject({ unread: null, sql: null, sqlNote: null });
    expect(hidden?.rule && hasRuleTargets(hidden.rule.targets)).toBe(false);
    // Nothing is worded from its definition, so no note is needed.
    expect(section.notes).toEqual([]);
    expect(present(true).items[0]?.rule).toBeNull();
    expect(present(null).items[0]?.rule).toBeNull();
  });

  it("keeps the 1.1 derived note while the trust of a rule in words is not recorded", () => {
    const derived = catalog["rule.note.derived"];
    const recorded = catalog["rule.note.derivedRecorded"];
    const notesOf = (sections: DetailSection[], kind: "checks" | "references") =>
      sectionOf(presentObjectDetails(tableDetails(sections), t), kind).notes;
    const checks = (...items: CheckFacts[]): DetailSection[] => [
      { kind: "checks", items, completeness: COMPLETE },
    ];
    const text = { status: "readable", text: "([OrderId]>(0))" } as const;
    expect(notesOf(checks(check("CK_A", text, true, true)), "checks")).toEqual([recorded]);
    expect(notesOf(checks(check("CK_A", text, true, false)), "checks")).toEqual([recorded]);
    // A file saved before 1.2 did not record trust, and a section that mixes keeps the clause.
    expect(notesOf(checks(check("CK_A", text, true)), "checks")).toEqual([derived]);
    expect(
      notesOf(checks(check("CK_A", text, true, true), check("CK_B", text, true)), "checks"),
    ).toEqual([derived]);
    // Only the rules in words count: a CHECK whose text is missing says nothing of the note.
    expect(
      notesOf(
        checks(check("CK_A", text, true, true), check("CK_B", { status: "notVisible" }, true)),
        "checks",
      ),
    ).toEqual([recorded]);
    const references = (...items: RelationFacts[]): DetailSection[] => [
      { kind: "references", items, completeness: COMPLETE },
    ];
    expect(notesOf(references(relation({ isTrusted: true })), "references")).toEqual([recorded]);
    expect(notesOf(references(relation({ isTrusted: null })), "references")).toEqual([derived]);
    expect(
      notesOf(
        references(relation({ isTrusted: false }), relation({ isTrusted: null })),
        "references",
      ),
    ).toEqual([derived]);
  });

  it("says nothing it cannot know about a key to a table the login cannot see", () => {
    const key = {
      name: "FK_Orders_Regions",
      referencingTable: { schema: "sales", name: "Orders" },
      columns: ["CustomerId"],
      onDelete: "cascade",
      onUpdate: "noAction",
      isEnabled: true,
    } as const;
    const invisible = presentRelation(
      relation({
        name: key.name,
        columns: [{ referencing: "CustomerId", referenced: null }],
        target: { status: "notVisible" },
        relation: null,
        explanation: explainForeignKeyToInvisibleTable({ ...key, columns: [...key.columns] }, SHOP),
      }),
      t,
    );
    // No SQL can be scripted without the referenced table, and no line is drawn for the key.
    expect(invisible.rule).toMatchObject({ sql: null, sqlNote: null });
    expect(invisible.rule.targets).toEqual({
      columns: new Map([["sales.Orders", ["CustomerId"]]]),
      relation: null,
    });
    expect(lines(invisible.rule.sentences)).toHaveLength(3);
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
              check("CK_OrderId", { status: "readable", text: "([OrderId]>(0))" }, true),
              check("CK_Email", { status: "notVisible" }, false),
              check("CK_Status", { status: "notRecorded" }, null),
            ],
            completeness: COMPLETE,
          },
        ]),
        t,
      ),
      "checks",
    );
    const [readable] = checks.items;
    expect(readable?.rule).toMatchObject({
      unread: null,
      sql: "([OrderId]>(0))",
      sqlNote: null,
      targets: { columns: new Map([["sales.Orders", ["OrderId"]]]), relation: null },
    });
    expect(lines(readable?.rule?.sentences ?? [])).toEqual([
      catalog["rule.check.gt"].replace("{column}", "OrderId").replace("{value}", "0"),
    ]);
    expect(
      checks.items.map((item) => ({ ...item, rule: item.rule === null ? null : "rule" })),
    ).toEqual([
      {
        name: "CK_OrderId",
        columns: [],
        badges: [],
        include: null,
        expression: { state: "readable", text: "([OrderId]>(0))", hint: null },
        rule: "rule",
      },
      {
        name: "CK_Email",
        columns: [],
        badges: [{ kind: "disabled", label: catalog["details.badge.disabled"] }],
        include: null,
        expression: {
          state: "notAvailable",
          text: catalog["definition.notAvailable"],
          hint: catalog["details.hint.notAvailable"],
        },
        rule: null,
      },
      {
        name: "CK_Status",
        columns: [],
        badges: [],
        include: null,
        expression: {
          state: "notRecorded",
          text: catalog["definition.notRecorded"],
          hint: catalog["details.hint.notRecorded"],
        },
        rule: null,
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
          items: [
            {
              name: "PK_Orders",
              columns: ["OrderId", "LineNumber"],
              isClustered: true,
              isEnabled: null,
            },
          ],
          completeness: COMPLETE,
        },
        {
          kind: "indexes",
          items: [
            index({ name: "UX_Email", columns: ["Email"], kind: "uniqueIndex" }),
            index({
              name: "UQ_Code",
              columns: ["Code"],
              kind: "uniqueConstraint",
              isClustered: true,
            }),
            index({ name: "IX_Name", columns: ["Name"], kind: "nonUnique" }),
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
        include: null,
        expression: null,
        rule: null,
      },
    ]);
    // Keys and indexes are no rules to put into words, and need no notes.
    expect(sectionOf(view, "indexes").notes).toEqual([]);
    expect(sectionOf(view, "indexes").items.map((item) => item.badges)).toEqual([
      [{ kind: "unique", label: catalog["indexKind.uniqueIndex"] }],
      [
        { kind: "unique", label: catalog["indexKind.uniqueConstraint"] },
        { kind: "clustered", label: catalog["indexKind.clustered"] },
      ],
      [],
    ]);
  });

  it("marks what a key or an index does not enforce, and lists included columns", () => {
    const view = presentObjectDetails(
      tableDetails([
        {
          kind: "primaryKey",
          items: [
            { name: "PK_Orders", columns: ["OrderId"], isClustered: false, isEnabled: false },
          ],
          completeness: COMPLETE,
        },
        {
          kind: "indexes",
          items: [
            index({ name: "UX_Open", kind: "uniqueIndex", isFiltered: true, isEnabled: true }),
            index({ name: "UQ_Code", kind: "uniqueConstraint", isEnabled: false }),
            index({
              name: "IX_Placed",
              includedColumns: ["Total", "Status"],
              isEnabled: false,
              isFiltered: false,
            }),
            index({ name: "IX_Saved", includedColumns: [] }),
          ],
          completeness: COMPLETE,
        },
      ]),
      t,
    );
    expect(sectionOf(view, "primaryKey").items[0]?.badges).toEqual([
      { kind: "disabled", label: catalog["details.badge.disabled"] },
    ]);
    const indexes = sectionOf(view, "indexes").items;
    expect(indexes.map((item) => item.badges)).toEqual([
      [
        { kind: "unique", label: catalog["indexKind.uniqueIndex"] },
        { kind: "filtered", label: catalog["details.badge.filtered"] },
      ],
      [
        { kind: "unique", label: catalog["indexKind.uniqueConstraint"] },
        { kind: "disabled", label: catalog["details.badge.disabled"] },
      ],
      [{ kind: "disabled", label: catalog["details.badge.indexDisabled"] }],
      [],
    ]);
    expect(indexes.map((item) => item.include)).toEqual([
      null,
      null,
      t.t("details.include", { columns: "Total, Status" }),
      null,
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
    definitions: "included",
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
      ["Indexes", 3],
      ["Check constraints", 1],
      ["Triggers", 3],
      ["References", 2],
      ["Referenced by", 1],
    ]);
    // A reader sees the state of the indexes as the owner does.
    expect(
      sectionOf(view, "indexes").items.map((item) => [
        item.name,
        item.badges.map((badge) => badge.label),
        item.include,
      ]),
    ).toEqual([
      ["IX_Orders_CustomerId", [], "INCLUDE (PlacedAt)"],
      ["UX_Orders_OpenCustomer", ["unique index", "filtered"], null],
      ["UQ_Orders_SalesRep", ["unique constraint", "disabled"], null],
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
      target: { goLabel: "Go to hr.Employees" },
    });
    expect(lines(references.items[0]?.rule.sentences ?? [])).toEqual([
      "Each row in sales.Orders belongs to at most one row in hr.Employees, and to none when SalesRepId is NULL",
      "A row in hr.Employees can be referenced by any number of rows in sales.Orders, or by none, because the index UQ_Orders_SalesRep is disabled",
      "Deleting a row in hr.Employees sets SalesRepId to NULL in the rows of sales.Orders that point to it",
    ]);
    // A key to a table the login cannot see says what its local columns and actions reveal.
    expect(references.items[1]).toMatchObject({
      columns: ["CustomerId"],
      rule: { sql: null, targets: { relation: null } },
    });
    expect(lines(references.items[1]?.rule.sentences ?? [])).toEqual([
      "Each row in sales.Orders belongs to exactly one row in a table not visible to this login",
      "Deleting a row in the referenced table is blocked if, once the statement has run, rows in sales.Orders still point to it",
      "Changing the referenced key of a row in the referenced table also changes CustomerId in the rows of sales.Orders that point to it",
    ]);
    expect(references.notes).toEqual([
      "SchemaCraft words these rules from their definitions. SQL Server checks them when values are written.",
    ]);
    const referencedBy = sectionOf(view, "referencedBy");
    expect(referencedBy.items.map((item) => item.name)).toEqual(["FK_OrderLines_Orders"]);
    expect(referencedBy.footnote).toBe(
      "Other tables that aren't visible to this login may reference it.",
    );
    // The text of the CHECK is not visible, so nothing is worded and no note is needed.
    expect(sectionOf(view, "checks").items[0]?.rule).toBeNull();
    expect(sectionOf(view, "checks").notes).toEqual([]);

    expect(presentObjectDetails(recentOrders, english)).toMatchObject({
      kind: "view",
      kindLabel: "View",
      summary: "2 columns",
    });
    expect(presentObjectDetails(recentOrders, english).sections).toHaveLength(3);
  });

  it("reads in Spanish", () => {
    const view = presentObjectDetails(orders, spanish);
    expect(view).toMatchObject({ kindLabel: "Tabla", summary: "5 columnas" });
    expect(view.sections.map((section) => section.title)).toEqual([
      "Columnas",
      "Clave primaria",
      "Índices",
      "Restricciones CHECK",
      "Desencadenadores",
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
    expect(references.items[0]).toMatchObject({ target: { goLabel: "Ir a hr.Employees" } });
    expect(lines(references.items[0]?.rule.sentences ?? [])).toEqual([
      "Cada fila de sales.Orders pertenece como mucho a una fila de hr.Employees, y a ninguna cuando SalesRepId es NULL",
      "Una fila de hr.Employees puede estar referenciada por cualquier número de filas de sales.Orders, o por ninguna, porque el índice UQ_Orders_SalesRep está deshabilitado",
      "Al borrar una fila de hr.Employees, las filas de sales.Orders que la referenciaban quedan con SalesRepId en NULL",
    ]);
    expect(
      sectionOf(view, "indexes").items.map((item) => item.badges.map((badge) => badge.label)),
    ).toEqual([[], ["índice único", "filtrado"], ["restricción única", "deshabilitada"]]);
    expect(references.items[1]?.target.label).toBe(
      "Una tabla no visible para este inicio de sesión",
    );
    expect(lines(references.items[1]?.rule.sentences ?? [])[0]).toBe(
      "Cada fila de sales.Orders pertenece exactamente a una fila de una tabla no visible para este inicio de sesión",
    );
    expect(sectionOf(view, "referencedBy").footnote).toBe(
      "Puede haber otras tablas no visibles para este inicio de sesión que hagan referencia a ella.",
    );
    expect(presentObjectDetails(recentOrders, spanish)).toMatchObject({
      kindLabel: "Vista",
      summary: "2 columnas",
    });
  });

  it("words the key of a self-reference with both of its columns on its one table", () => {
    const employees = describeObjectDetails(partial, "hr.Employees", scope);
    if (employees === null) {
      throw new Error("the fixture changed");
    }
    const [manager] = sectionOf(presentObjectDetails(employees, english), "references").items;
    expect(manager?.rule.targets).toEqual({
      columns: new Map([["hr.Employees", ["ManagerId", "EmployeeId"]]]),
      relation: "hr.Employees.FK_Employees_Manager",
    });
    // It is disabled, so it holds only once it is enabled again.
    expect(lines(manager?.rule.sentences ?? [])).toEqual([
      "When enabled:",
      "  Each row in hr.Employees belongs to at most one row of the same table, which may be itself, and to none when ManagerId is NULL",
      "  A row in hr.Employees can be referenced by any number of rows of the same table, or by none",
      "  Deleting a row in hr.Employees is blocked if, once the statement has run, rows of the same table still point to it",
    ]);
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
    ).toEqual(Array.from({ length: 7 }, () => `Not checked since ${date}`));
  });
});

describe("the CHECKs of the preview fixture, read by its owner", () => {
  const scope: DetailsScope = {
    hiddenKeys: new Set(),
    coverage: SHOP.access?.coverage ?? null,
    carriedOver: [],
    isSchemaFiltered: false,
    isDiagramOnly: false,
    definitions: "included",
  };
  const checksOf = (
    key: string,
    translator: DetailsTranslator,
    carriedOver = scope.carriedOver,
  ) => {
    const details = describeObjectDetails(SHOP, key, { ...scope, carriedOver });
    if (details === null) {
      throw new Error("the fixture changed");
    }
    return sectionOf(presentObjectDetails(details, translator), "checks");
  };

  it("words what it can read, shows the SQL of what it cannot, and notes each once", () => {
    const checks = checksOf("dbo.Customers", english);
    const [email, name] = checks.items;
    expect(lines(email?.rule?.sentences ?? [])).toEqual(["Email must match the pattern '%_@_%'"]);
    expect(email?.rule?.targets.columns).toEqual(new Map([["dbo.Customers", ["Email"]]]));
    // It was enabled again without checking the rows already there, which is still said.
    expect(name?.rule).toMatchObject({
      unread: "This rule can't be put into words. Its definition, as SQL Server stores it:",
      sql: "([dbo].[fn_valid_name]([Name])=(1))",
      sqlNote: null,
      targets: { columns: new Map([["dbo.Customers", ["Name"]]]), relation: null },
    });
    expect(lines(name?.rule?.sentences ?? [])).toEqual([
      "Rows already in dbo.Customers may not follow this rule: SQL Server marks it as not trusted",
    ]);
    expect(name?.badges).toEqual([{ kind: "untrusted", label: "not trusted" }]);
    expect(email?.badges).toEqual([]);
    expect(checks.notes).toEqual([
      "In a pattern, % stands for any text, _ for any one character and [ ] for one character from a set.",
      "Text comparisons follow the column's collation, which may ignore case, accents or some characters, and two texts that differ only in trailing spaces count as equal.",
      "SchemaCraft words these rules from their definitions. SQL Server checks them when values are written.",
    ]);
    expect(checksOf("dbo.Customers", spanish).notes).toHaveLength(3);
  });

  it("puts a disabled CHECK under When enabled, in both languages", () => {
    expect(lines(checksOf("hr.Employees", english).items[0]?.rule?.sentences ?? [])).toEqual([
      "When enabled:",
      "  When ManagerId has a value:",
      "    ManagerId must be different from EmployeeId",
    ]);
    expect(lines(checksOf("hr.Employees", spanish).items[0]?.rule?.sentences ?? [])).toEqual([
      "Cuando se habilite:",
      "  Cuando ManagerId tiene un valor:",
      "    ManagerId debe ser diferente de EmployeeId",
    ]);
  });

  it("words a text kept from an earlier read, which its hint dates", () => {
    const [status] = checksOf("sales.Orders", english, [
      {
        object: { schema: "sales", name: "Orders" },
        fact: { kind: "checkConstraint", name: "CK_Orders_Status" },
        readAt: READ_AT,
      },
    ]).items;
    expect(status?.expression).toMatchObject({
      state: "notChecked",
      hint: `Read on ${formatDate(READ_AT, "en")}; this login couldn't check it since.`,
    });
    expect(lines(status?.rule?.sentences ?? [])).toEqual([
      "Status must be one of 'N', 'P', 'S', or 'C'",
    ]);
  });
});
