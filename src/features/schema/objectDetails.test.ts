import { describe, expect, it } from "vitest";

import type {
  CarriedFact,
  CheckConstraint,
  Column,
  SchemaSnapshot,
  Table,
} from "@/shared/contracts";
import { previewSnapshot } from "@/shared/ipc/previewConnectionBackend";

import { TABLE_SECTIONS, describeObjectDetails } from "./objectDetails";
import { foreignKeyExplanation } from "./rules/foreignKeyReader";
import type {
  DetailSection,
  DetailSectionKind,
  DetailsScope,
  ObjectDetails,
} from "./objectDetails";

/** The fixture as its owner reads it, and as a login that sees hr and sales but not dbo does. */
const full = previewSnapshot("Shop", "full");
const partial = previewSnapshot("Shop", "partial");
const READ_AT = "2026-10-12T08:00:00Z";

/** The scope the Inspector derives from a project, unless a test says otherwise. */
function scopeOf(snapshot: SchemaSnapshot, overrides: Partial<DetailsScope> = {}): DetailsScope {
  return {
    hiddenKeys: new Set(),
    coverage: snapshot.access?.coverage ?? null,
    carriedOver: snapshot.carriedOver ?? [],
    isSchemaFiltered: false,
    isDiagramOnly: false,
    ...overrides,
  };
}

function detailsOf(snapshot: SchemaSnapshot, key: string, overrides?: Partial<DetailsScope>) {
  const details = describeObjectDetails(snapshot, key, scopeOf(snapshot, overrides));
  if (details === null) {
    throw new Error(`${key} is not in the snapshot`);
  }
  return details;
}

function sectionOf<Kind extends DetailSectionKind>(
  details: ObjectDetails,
  kind: Kind,
): Extract<DetailSection, { kind: Kind }> {
  const section = details.sections.find(
    (candidate): candidate is Extract<DetailSection, { kind: Kind }> => candidate.kind === kind,
  );
  if (section === undefined) {
    throw new Error(`${details.key} has no ${kind} section`);
  }
  return section;
}

function withTable(snapshot: SchemaSnapshot, name: string, change: (table: Table) => Table) {
  return {
    ...snapshot,
    tables: snapshot.tables.map((table) => (table.name.name === name ? change(table) : table)),
  };
}

/**
 * The fixture as SchemaCraft 1.0 saved it: no access profile, and the gaps it left unrecorded
 * in sales.Orders, the default of Status and the text and state of its CHECK.
 */
function asFormatOne(snapshot: SchemaSnapshot): SchemaSnapshot {
  const copy = withTable(snapshot, "Orders", (table) => ({
    ...table,
    columns: table.columns.map((column): Column =>
      column.name === "Status"
        ? { ...column, defaultExpression: { status: "notRecorded" } }
        : column,
    ),
    // 1.0 recorded neither the state nor the trust of a constraint.
    checkConstraints: table.checkConstraints.map((constraint): CheckConstraint => ({
      name: constraint.name,
      expression: { status: "notRecorded" },
      isEnabled: null,
    })),
  }));
  delete copy.access;
  return copy;
}

describe("describeObjectDetails", () => {
  it("gives a table six sections in a fixed order and a view its columns only", () => {
    const orders = detailsOf(full, "sales.Orders");
    expect(orders.sections.map((section) => section.kind)).toEqual(TABLE_SECTIONS);
    expect(orders).toMatchObject({
      key: "sales.Orders",
      name: { schema: "sales", name: "Orders" },
      kind: "table",
      columnCount: 5,
      notCheckedSince: null,
    });

    const recentOrders = detailsOf(full, "sales.RecentOrders");
    expect(recentOrders.sections.map((section) => section.kind)).toEqual(["columns"]);
    expect(recentOrders).toMatchObject({ kind: "view", columnCount: 2 });
    expect(sectionOf(recentOrders, "columns").items.map((column) => column.name)).toEqual([
      "OrderId",
      "CustomerName",
    ]);

    expect(describeObjectDetails(full, "dbo.Nothing", scopeOf(full))).toBeNull();
  });

  it("lists the columns in ordinal order with their type, nullability and flags", () => {
    const columns = sectionOf(detailsOf(full, "sales.Orders"), "columns");
    expect(columns.completeness).toEqual({ status: "complete" });
    expect(columns.items.map((column) => column.name)).toEqual([
      "OrderId",
      "CustomerId",
      "SalesRepId",
      "PlacedAt",
      "Status",
    ]);
    expect(columns.items[0]).toEqual({
      name: "OrderId",
      type: "int",
      isNullable: false,
      isIdentity: true,
      isComputed: false,
      isPrimaryKey: true,
      isForeignKey: false,
      defaultValue: null,
    });
    expect(columns.items[1]).toMatchObject({ name: "CustomerId", isForeignKey: true });
    expect(columns.items[2]).toMatchObject({
      name: "SalesRepId",
      isNullable: true,
      isForeignKey: true,
    });
    expect(columns.items[3]).toMatchObject({
      name: "PlacedAt",
      type: "datetime2(7)",
      defaultValue: { status: "readable", text: "(sysutcdatetime())" },
    });
    expect(columns.items[4]).toMatchObject({ type: "char(1)", defaultValue: { text: "('N')" } });

    const lines = sectionOf(detailsOf(full, "sales.OrderLines"), "columns").items;
    // A column of a composite primary key that is also a foreign key carries both flags.
    expect(lines[0]).toMatchObject({ name: "OrderId", isPrimaryKey: true, isForeignKey: true });
    expect(lines[5]).toMatchObject({
      name: "LineTotal",
      type: "decimal(21,2)",
      isNullable: true,
      isComputed: true,
    });

    const customers = sectionOf(detailsOf(full, "dbo.Customers"), "columns").items;
    expect(customers.map((column) => column.type)).toEqual([
      "int",
      "nvarchar(120)",
      "varchar(254)",
      "nvarchar(max)",
      "datetime2(7)",
    ]);
  });

  it("describes the primary key, the indexes and the CHECK constraints", () => {
    const customers = detailsOf(full, "dbo.Customers");
    expect(sectionOf(customers, "primaryKey")).toEqual({
      kind: "primaryKey",
      items: [
        { name: "PK_Customers", columns: ["CustomerId"], isClustered: true, isEnabled: true },
      ],
      completeness: { status: "complete" },
    });
    expect(sectionOf(customers, "indexes")).toEqual({
      kind: "indexes",
      items: [
        {
          name: "UX_Customers_Email",
          columns: ["Email"],
          kind: "uniqueIndex",
          isClustered: false,
          includedColumns: [],
          isFiltered: false,
          isEnabled: true,
        },
      ],
      completeness: { status: "complete" },
    });
    const checks = sectionOf(customers, "checks").items;
    expect(
      checks.map(({ name, expression, isEnabled, isTrusted }) => ({
        name,
        expression,
        isEnabled,
        isTrusted,
      })),
    ).toEqual([
      {
        name: "CK_Customers_Email",
        expression: { status: "readable", text: "([Email] like '%_@_%')" },
        isEnabled: true,
        isTrusted: true,
      },
      {
        name: "CK_Customers_Name",
        expression: { status: "readable", text: "([dbo].[fn_valid_name]([Name])=(1))" },
        isEnabled: true,
        isTrusted: false,
      },
    ]);
    // Each is read against the columns of its own table: in words, or as SQL the reader cannot
    // word, which still says that the rows already there may not follow it.
    expect(checks.map((check) => check.reading)).toMatchObject([
      { status: "read", columns: ["Email"], sql: "([Email] like '%_@_%')" },
      {
        status: "unread",
        rules: [{ kind: "sentence", text: { key: "rule.trust.notVerified" } }],
        columns: ["Name"],
        sql: "([dbo].[fn_valid_name]([Name])=(1))",
      },
    ]);

    const orders = detailsOf(full, "sales.Orders");
    expect(
      sectionOf(orders, "indexes").items.map(
        ({ name, includedColumns, isFiltered, isEnabled }) => ({
          name,
          includedColumns,
          isFiltered,
          isEnabled,
        }),
      ),
    ).toEqual([
      {
        name: "IX_Orders_CustomerId",
        includedColumns: ["PlacedAt"],
        isFiltered: false,
        isEnabled: true,
      },
      { name: "UX_Orders_OpenCustomer", includedColumns: [], isFiltered: true, isEnabled: true },
      { name: "UQ_Orders_SalesRep", includedColumns: [], isFiltered: false, isEnabled: false },
    ]);

    const employees = detailsOf(full, "hr.Employees");
    expect(sectionOf(employees, "indexes")).toEqual({
      kind: "indexes",
      items: [],
      completeness: { status: "complete" },
    });
    expect(sectionOf(employees, "checks").items).toMatchObject([
      {
        name: "CK_Employees_Manager",
        expression: { status: "readable", text: "([ManagerId]<>[EmployeeId])" },
        isEnabled: false,
        reading: { status: "read", columns: ["ManagerId", "EmployeeId"] },
      },
    ]);
  });

  it("relates a table to the ones it references and to the ones that reference it", () => {
    const orders = detailsOf(full, "sales.Orders");
    const references = sectionOf(orders, "references");
    expect(references.completeness).toEqual({ status: "complete" });
    expect(references.items).toMatchObject([
      {
        name: "FK_Orders_Customers",
        columns: [{ referencing: "CustomerId", referenced: "CustomerId" }],
        onDelete: "noAction",
        onUpdate: "cascade",
        isEnabled: true,
        target: {
          status: "available",
          key: "dbo.Customers",
          name: { schema: "dbo", name: "Customers" },
        },
        notCheckedSince: null,
      },
      {
        name: "FK_Orders_SalesRep",
        columns: [{ referencing: "SalesRepId", referenced: "EmployeeId" }],
        onDelete: "setNull",
        onUpdate: "noAction",
        isEnabled: true,
        target: {
          status: "available",
          key: "hr.Employees",
          name: { schema: "hr", name: "Employees" },
        },
        notCheckedSince: null,
      },
    ]);
    // Each key carries its words, the same the canvas reads for the snapshot, and the id of
    // the relationship drawn for it.
    for (const [index, key] of [
      full.foreignKeys.find((candidate) => candidate.name === "FK_Orders_Customers"),
      full.foreignKeys.find((candidate) => candidate.name === "FK_Orders_SalesRep"),
    ].entries()) {
      if (key === undefined) {
        throw new Error("the fixture changed");
      }
      expect(references.items[index]?.explanation).toBe(foreignKeyExplanation(full, key));
      expect(references.items[index]?.relation).toBe(`sales.Orders.${key.name}`);
    }
    const referencedBy = sectionOf(orders, "referencedBy");
    expect(referencedBy.completeness).toEqual({ status: "complete" });
    expect(referencedBy.items).toMatchObject([
      {
        name: "FK_OrderLines_Orders",
        onDelete: "cascade",
        target: { status: "available", key: "sales.OrderLines" },
      },
    ]);

    // A self-reference is an outgoing key to the table itself and never an incoming one.
    const employees = detailsOf(full, "hr.Employees");
    expect(sectionOf(employees, "references").items).toMatchObject([
      {
        name: "FK_Employees_Manager",
        isEnabled: false,
        target: { status: "self", key: "hr.Employees" },
      },
    ]);
    expect(sectionOf(employees, "referencedBy").items).toMatchObject([
      { name: "FK_Orders_SalesRep", target: { status: "available", key: "sales.Orders" } },
    ]);
  });

  it("marks a target hidden on the canvas, and one that is not in the project", () => {
    const orders = detailsOf(full, "sales.Orders", { hiddenKeys: new Set(["dbo.Customers"]) });
    expect(sectionOf(orders, "references").items.map((relation) => relation.target)).toEqual([
      { status: "hidden", key: "dbo.Customers", name: { schema: "dbo", name: "Customers" } },
      { status: "available", key: "hr.Employees", name: { schema: "hr", name: "Employees" } },
    ]);

    const withGhost: SchemaSnapshot = {
      ...full,
      foreignKeys: [
        ...full.foreignKeys,
        {
          name: "FK_Orders_Ghost",
          referencingTable: { schema: "sales", name: "Orders" },
          referencedTable: { schema: "dbo", name: "Ghost" },
          columnPairs: [{ referencingColumn: "Status", referencedColumn: "Code" }],
          onDelete: "noAction",
          onUpdate: "noAction",
          isEnabled: true,
        },
      ],
    };
    const ghost = sectionOf(detailsOf(withGhost, "sales.Orders"), "references").items[2];
    expect(ghost?.target).toEqual({
      status: "unknown",
      key: "dbo.Ghost",
      name: { schema: "dbo", name: "Ghost" },
    });
  });

  it("lists keys to tables the login cannot see and doubts the incoming ones under partial access", () => {
    expect(partial.access?.coverage).toMatchObject({ objects: "partial", definitions: "partial" });
    const orders = detailsOf(partial, "sales.Orders");

    const references = sectionOf(orders, "references");
    expect(references.completeness).toEqual({ status: "complete" });
    expect(references.items).toMatchObject([
      { name: "FK_Orders_SalesRep", target: { status: "available", key: "hr.Employees" } },
      {
        name: "FK_Orders_Customers",
        columns: [{ referencing: "CustomerId", referenced: null }],
        onUpdate: "cascade",
        isEnabled: true,
        target: { status: "notVisible" },
        notCheckedSince: null,
        // Worded from its local columns and actions; no line is drawn and no SQL scripted.
        explanation: {
          childCardinality: null,
          sql: null,
          columns: new Map([["sales.Orders", ["CustomerId"]]]),
        },
        relation: null,
      },
    ]);
    // The column still reads as a foreign key, as its badge on the diagram does.
    expect(sectionOf(orders, "columns").items[1]).toMatchObject({
      name: "CustomerId",
      isForeignKey: true,
    });

    const referencedBy = sectionOf(orders, "referencedBy");
    expect(referencedBy.completeness).toEqual({ status: "notVisible" });
    expect(referencedBy.items.map((relation) => relation.name)).toEqual(["FK_OrderLines_Orders"]);

    // What the login sees of a table, it sees in full; only the texts can be missing.
    for (const kind of ["columns", "primaryKey", "indexes", "checks"] as const) {
      expect(sectionOf(orders, kind).completeness).toEqual({ status: "complete" });
    }
    expect(sectionOf(orders, "columns").items[3]?.defaultValue).toEqual({ status: "notAvailable" });
    expect(sectionOf(orders, "checks").items[0]?.expression).toEqual({ status: "notAvailable" });
    const employees = detailsOf(partial, "hr.Employees");
    expect(sectionOf(employees, "columns").items[3]?.defaultValue).toEqual({
      status: "readable",
      text: "(CONVERT([date],getdate()))",
    });
  });

  it("words a key of an exported file as the application does, from what travels beside it", () => {
    // SET DEFAULT on a nullable column without a default sets it to NULL, which only a capture
    // that recorded what the login could see may say.
    const withSetDefault = (snapshot: SchemaSnapshot): SchemaSnapshot => ({
      ...snapshot,
      foreignKeys: snapshot.foreignKeys.map((key) =>
        key.name === "FK_Orders_SalesRep" ? { ...key, onDelete: "setDefault" } : key,
      ),
    });
    const application = withSetDefault(full);
    const exported = withSetDefault(full);
    delete exported.access;
    const salesRep = (details: ObjectDetails) =>
      sectionOf(details, "references").items.find((item) => item.name === "FK_Orders_SalesRep")
        ?.explanation.deleteRule;

    const inApplication = salesRep(detailsOf(application, "sales.Orders"));
    expect(inApplication).toMatchObject({ plural: "rule.fk.delete.setDefaultNull" });
    expect(
      salesRep(detailsOf(exported, "sales.Orders", { coverage: full.access?.coverage ?? null })),
    ).toEqual(inApplication);
    // Without the verdicts beside it, a default may have gone unread, so the words stay neutral.
    expect(salesRep(detailsOf(exported, "sales.Orders", { coverage: null }))).toMatchObject({
      plural: "rule.fk.delete.setDefaultNeutral",
    });
  });

  it("says a 1.0 file recorded neither the missing texts nor the dropped keys", () => {
    const orders = detailsOf(asFormatOne(full), "sales.Orders");
    expect(sectionOf(orders, "columns").items[4]?.defaultValue).toEqual({ status: "notRecorded" });
    expect(sectionOf(orders, "checks").items).toEqual([
      {
        name: "CK_Orders_Status",
        expression: { status: "notRecorded" },
        isEnabled: null,
        isTrusted: null,
        reading: { status: "notRecorded", rules: [] },
      },
    ]);
    expect(sectionOf(orders, "references").completeness).toEqual({ status: "notRecorded" });
    expect(sectionOf(orders, "referencedBy").completeness).toEqual({ status: "notRecorded" });
    expect(sectionOf(orders, "columns").completeness).toEqual({ status: "complete" });
  });

  it("keeps facts from an earlier read and says when they were last read", () => {
    const orders = { schema: "sales", name: "Orders" };
    const carriedOver: CarriedFact[] = [
      { object: orders, fact: { kind: "columnDefault", column: "PlacedAt" }, readAt: READ_AT },
      {
        object: orders,
        fact: { kind: "checkConstraint", name: "CK_Orders_Status" },
        readAt: READ_AT,
      },
      { object: orders, fact: { kind: "foreignKey", name: "FK_Orders_SalesRep" }, readAt: READ_AT },
    ];
    const details = detailsOf(full, "sales.Orders", { carriedOver });
    expect(details.notCheckedSince).toBeNull();
    const columns = sectionOf(details, "columns").items;
    expect(columns[3]?.defaultValue).toEqual({
      status: "notChecked",
      text: "(sysutcdatetime())",
      readAt: READ_AT,
    });
    expect(columns[4]?.defaultValue).toEqual({ status: "readable", text: "('N')" });
    expect(sectionOf(details, "checks").items[0]?.expression).toEqual({
      status: "notChecked",
      text: "([Status]='C' OR [Status]='S' OR [Status]='P' OR [Status]='N')",
      readAt: READ_AT,
    });
    expect(
      sectionOf(details, "references").items.map((relation) => relation.notCheckedSince),
    ).toEqual([null, READ_AT]);
    // The key is dated on both of its ends.
    expect(
      sectionOf(detailsOf(full, "hr.Employees", { carriedOver }), "referencedBy").items[0]
        ?.notCheckedSince,
    ).toBe(READ_AT);
  });

  it("dates every list of an object kept whole from an earlier read", () => {
    const carriedOver: CarriedFact[] = [
      { object: { schema: "sales", name: "Orders" }, fact: { kind: "table" }, readAt: READ_AT },
      {
        object: { schema: "sales", name: "RecentOrders" },
        fact: { kind: "view" },
        readAt: READ_AT,
      },
    ];
    const orders = detailsOf(partial, "sales.Orders", { carriedOver });
    expect(orders.notCheckedSince).toBe(READ_AT);
    for (const section of orders.sections) {
      expect(section.completeness, section.kind).toEqual({ status: "notChecked", readAt: READ_AT });
    }
    const view = detailsOf(partial, "sales.RecentOrders", { carriedOver });
    expect(view.notCheckedSince).toBe(READ_AT);
    expect(sectionOf(view, "columns").completeness).toEqual({
      status: "notChecked",
      readAt: READ_AT,
    });
    // Another table of the same capture is dated only where its own facts were kept.
    expect(detailsOf(partial, "hr.Employees", { carriedOver }).notCheckedSince).toBeNull();
  });

  it("dates every text inside an object kept whole, each one kept on its own at its own moment", () => {
    const EARLIER = "2026-09-30T08:00:00Z";
    const orders = { schema: "sales", name: "Orders" };
    const snapshot = withTable(full, "Orders", (table) => ({
      ...table,
      checkConstraints: [
        ...table.checkConstraints,
        {
          name: "CK_Orders_PlacedAt",
          expression: { status: "readable", text: "([PlacedAt]>'2000-01-01')" },
          isEnabled: true,
        },
      ],
    }));
    const carriedOver: CarriedFact[] = [
      { object: orders, fact: { kind: "table" }, readAt: READ_AT },
      // Kept on its own by an earlier refresh, then kept again with the whole table.
      {
        object: orders,
        fact: { kind: "checkConstraint", name: "CK_Orders_PlacedAt" },
        readAt: EARLIER,
      },
    ];
    const details = detailsOf(snapshot, "sales.Orders", { carriedOver });
    expect(sectionOf(details, "columns").items.map((column) => column.defaultValue)).toEqual([
      null,
      null,
      null,
      { status: "notChecked", text: "(sysutcdatetime())", readAt: READ_AT },
      { status: "notChecked", text: "('N')", readAt: READ_AT },
    ]);
    expect(sectionOf(details, "checks").items.map((check) => check.expression)).toEqual([
      {
        status: "notChecked",
        text: "([Status]='C' OR [Status]='S' OR [Status]='P' OR [Status]='N')",
        readAt: READ_AT,
      },
      { status: "notChecked", text: "([PlacedAt]>'2000-01-01')", readAt: EARLIER },
    ]);
    // A text the earlier read could not see stays not available.
    const hidden = detailsOf(partial, "sales.Orders", { carriedOver });
    expect(sectionOf(hidden, "checks").items[0]?.expression).toEqual({ status: "notAvailable" });
  });

  it("says what an empty relation list may be missing, in order of precedence", () => {
    const relations = (overrides: Partial<DetailsScope>) => {
      const customers = detailsOf(full, "dbo.Customers", overrides);
      return {
        references: sectionOf(customers, "references").completeness,
        referencedBy: sectionOf(customers, "referencedBy").completeness,
      };
    };
    const partialObjects = { objects: "partial", definitions: "complete" } as const;

    expect(sectionOf(detailsOf(full, "dbo.Customers"), "references").items).toEqual([]);
    expect(relations({})).toEqual({
      references: { status: "complete" },
      referencedBy: { status: "complete" },
    });
    expect(relations({ isSchemaFiltered: true })).toEqual({
      references: { status: "inspectedSchemas" },
      referencedBy: { status: "inspectedSchemas" },
    });
    expect(relations({ isDiagramOnly: true, isSchemaFiltered: true })).toEqual({
      references: { status: "diagram" },
      referencedBy: { status: "diagram" },
    });
    expect(relations({ coverage: null, isDiagramOnly: true })).toEqual({
      references: { status: "notRecorded" },
      referencedBy: { status: "notRecorded" },
    });
    // Outgoing keys to tables the login cannot see are listed, so only the incoming list is in doubt.
    expect(relations({ coverage: partialObjects, isDiagramOnly: true })).toEqual({
      references: { status: "diagram" },
      referencedBy: { status: "notVisible" },
    });
    expect(relations({ coverage: partialObjects })).toEqual({
      references: { status: "complete" },
      referencedBy: { status: "notVisible" },
    });
  });
});
