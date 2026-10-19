import { describe, expect, it } from "vitest";

import type {
  AccessProfile,
  Column,
  Definition,
  ForeignKey,
  ForeignKeyToInvisibleTable,
  Index,
  ReferentialAction,
  SchemaSnapshot,
  Table,
} from "@/shared/contracts";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";
import { previewSnapshot } from "@/shared/ipc/previewConnectionBackend";

import {
  explainForeignKey,
  explainForeignKeyToInvisibleTable,
  foreignKeyChildCardinality,
  foreignKeyChildCardinalityReading,
  foreignKeyDefinitionSql,
  foreignKeyExplanation,
  foreignKeyExplanations,
  foreignKeyOptionality,
} from "./foreignKeyReader";
import type { ForeignKeyExplanation } from "./foreignKeyReader";
import { formatRuleText, ruleTextToString } from "./ruleText";
import type { RuleNode, RuleTranslator } from "./ruleText";

/**
 * The foreign key reader on a snapshot that mirrors the SQL Server fixture (fixture.sql), plus
 * synthetic keys for the cases the fixture does not hold. The claims the sentences rest on
 * (a disabled key checks nothing, a composite key with a NULL is not checked, an identity
 * column cannot be updated, SET DEFAULT falls back to NULL) are pinned against the engine by
 * `foreign_key_engine_facts_behind_the_sentences` in tests/sqlserver_integration.rs.
 */

interface ColumnTraits {
  isNullable?: boolean;
  isIdentity?: boolean;
  defaultExpression?: Definition | null;
}

function column(name: string, traits: ColumnTraits = {}): Column {
  return {
    name,
    ordinalPosition: 0,
    dataType: {
      name: "int",
      length: null,
      precision: null,
      scale: null,
      userDefinedTypeName: null,
    },
    isNullable: traits.isNullable ?? false,
    defaultExpression: traits.defaultExpression ?? null,
    isIdentity: traits.isIdentity ?? false,
    isComputed: false,
  };
}

/** An index whose state, unless given, was not recorded, as in a file saved before 1.2. */
function index(
  name: string,
  kind: Index["kind"],
  columns: string[],
  state: Pick<Index, "includedColumns" | "isFiltered" | "isEnabled"> = {},
): Index {
  return { name, columns, kind, isClustered: false, ...state };
}

function table(
  qualified: string,
  columns: Column[],
  primaryKey: string[] | null,
  indexes: Index[] = [],
): Table {
  const [schema = "", name = ""] = qualified.split(".");
  return {
    name: { schema, name },
    columns: columns.map((entry, position) => ({ ...entry, ordinalPosition: position + 1 })),
    primaryKey:
      primaryKey === null ? null : { name: `PK_${name}`, columns: primaryKey, isClustered: true },
    indexes,
    checkConstraints: [],
  };
}

function qualifiedName(qualified: string) {
  const [schema = "", name = ""] = qualified.split(".");
  return { schema, name };
}

function key(
  name: string,
  referencing: string,
  referencingColumns: string[],
  referenced: string,
  referencedColumns: string[],
  actions: { onDelete?: ReferentialAction; onUpdate?: ReferentialAction; isEnabled?: boolean } = {},
): ForeignKey {
  return {
    name,
    referencingTable: qualifiedName(referencing),
    referencedTable: qualifiedName(referenced),
    columnPairs: referencingColumns.map((referencingColumn, position) => ({
      referencingColumn,
      referencedColumn: referencedColumns[position] ?? "",
    })),
    onDelete: actions.onDelete ?? "noAction",
    onUpdate: actions.onUpdate ?? "noAction",
    isEnabled: actions.isEnabled ?? true,
  };
}

/** What the owner of the preview fixture can see: everything, defaults included. */
const ACCESS: AccessProfile | undefined = previewSnapshot("Shop", "full").access;

const readable = (text: string): Definition => ({ status: "readable", text });

/** The fixture database, plus tables for the cases it lacks. */
const TABLES: Table[] = [
  table(
    "dbo.Customers",
    [column("CustomerId", { isIdentity: true }), column("Email")],
    ["CustomerId"],
    [index("UQ_Customers_Email", "uniqueConstraint", ["Email"])],
  ),
  table("dbo.Tags", [column("TagId")], ["TagId"]),
  table("dbo.CustomerTags", [column("CustomerId"), column("TagId")], ["CustomerId", "TagId"]),
  table(
    "hr.Employees",
    [column("EmployeeId", { isIdentity: true }), column("ManagerId", { isNullable: true })],
    ["EmployeeId"],
  ),
  table(
    "sales.Orders",
    [
      column("OrderId", { isIdentity: true }),
      column("CustomerId"),
      column("SalesRepId", { isNullable: true }),
      column("PlacedAt"),
      column("RegionId", { isNullable: true }),
    ],
    ["OrderId"],
    [
      index("IX_Orders_CustomerId", "nonUnique", ["CustomerId"]),
      index("UX_Orders_Customer_PlacedAt", "uniqueIndex", ["CustomerId", "PlacedAt"]),
    ],
  ),
  table("sales.OrderLines", [column("OrderId"), column("LineNumber")], ["OrderId", "LineNumber"]),
  table(
    "sales.Shipments",
    [column("ShipmentId"), column("OrderId"), column("LineNumber")],
    ["ShipmentId"],
  ),
  // One note per order: the child's primary key is the key.
  table("sales.OrderNotes", [column("OrderId")], ["OrderId"]),
  // A unique constraint inside the key columns, and a unique index that may be filtered.
  table(
    "sales.Accounts",
    [column("AccountId"), column("CustomerId"), column("RegionId")],
    ["AccountId"],
    [index("UQ_Accounts_Customer", "uniqueConstraint", ["CustomerId"])],
  ),
  table(
    "sales.Cards",
    [column("CardId"), column("CustomerId")],
    ["CardId"],
    [index("UX_Cards_Current", "uniqueIndex", ["CustomerId"])],
  ),
  // A parent whose key is not an identity, so its key can change.
  table(
    "facts.Parents",
    [column("ParentId", { isIdentity: true }), column("Code")],
    ["ParentId"],
    [index("UQ_Parents_Code", "uniqueConstraint", ["Code"])],
  ),
  table("facts.Pairs", [column("PairA"), column("PairB")], ["PairA", "PairB"]),
  // Self-references whose key can change: on one column, and on a composite key.
  table(
    "facts.Nodes",
    [column("NodeId"), column("ParentNodeId", { isNullable: true })],
    ["NodeId"],
  ),
  table(
    "facts.Folders",
    [column("TenantId"), column("FolderId"), column("ParentFolderId", { isNullable: true })],
    ["TenantId", "FolderId"],
  ),
  table(
    "facts.Children",
    [
      column("ChildId"),
      column("ParentCode", { isNullable: true }),
      column("WithDefault", { isNullable: true, defaultExpression: readable("('P0')") }),
      column("OtherDefault", { isNullable: true, defaultExpression: readable("('Q0')") }),
      column("NullDefault", { isNullable: true, defaultExpression: readable("(NULL)") }),
      column("HiddenDefault", { isNullable: true, defaultExpression: { status: "notVisible" } }),
      column("PairA"),
      column("PairB", { isNullable: true }),
      column("PairC", { isNullable: true }),
    ],
    ["ChildId"],
  ),
];

const FOREIGN_KEYS = {
  ordersCustomers: key(
    "FK_Orders_Customers",
    "sales.Orders",
    ["CustomerId"],
    "dbo.Customers",
    ["CustomerId"],
    { onUpdate: "cascade" },
  ),
  ordersEmployees: key(
    "FK_Orders_Employees",
    "sales.Orders",
    ["SalesRepId"],
    "hr.Employees",
    ["EmployeeId"],
    { onDelete: "setNull" },
  ),
  orderLinesOrders: key(
    "FK_OrderLines_Orders",
    "sales.OrderLines",
    ["OrderId"],
    "sales.Orders",
    ["OrderId"],
    { onDelete: "cascade" },
  ),
  shipmentsOrderLines: key(
    "FK_Shipments_OrderLines",
    "sales.Shipments",
    ["OrderId", "LineNumber"],
    "sales.OrderLines",
    ["OrderId", "LineNumber"],
  ),
  shipmentsOrdersDisabled: key(
    "FK_Shipments_Orders_Disabled",
    "sales.Shipments",
    ["OrderId"],
    "sales.Orders",
    ["OrderId"],
    { isEnabled: false },
  ),
  employeesManager: key("FK_Employees_Manager", "hr.Employees", ["ManagerId"], "hr.Employees", [
    "EmployeeId",
  ]),
  customerTagsCustomers: key(
    "FK_CustomerTags_Customers",
    "dbo.CustomerTags",
    ["CustomerId"],
    "dbo.Customers",
    ["CustomerId"],
    { onDelete: "cascade" },
  ),
  orderNotesOrders: key("FK_OrderNotes_Orders", "sales.OrderNotes", ["OrderId"], "sales.Orders", [
    "OrderId",
  ]),
  accountsCustomers: key(
    "FK_Accounts_Customers",
    "sales.Accounts",
    ["CustomerId", "RegionId"],
    "dbo.Customers",
    ["CustomerId", "Email"],
  ),
  cardsCustomers: key("FK_Cards_Customers", "sales.Cards", ["CustomerId"], "dbo.Customers", [
    "CustomerId",
  ]),
  childrenPairs: key("FK_Children_Pairs", "facts.Children", ["PairA", "PairB"], "facts.Pairs", [
    "PairA",
    "PairB",
  ]),
  nodesParent: key("FK_Nodes_Parent", "facts.Nodes", ["ParentNodeId"], "facts.Nodes", ["NodeId"]),
  foldersParent: key(
    "FK_Folders_Parent",
    "facts.Folders",
    ["TenantId", "ParentFolderId"],
    "facts.Folders",
    ["TenantId", "FolderId"],
  ),
} satisfies Record<string, ForeignKey>;

const INVISIBLE: ForeignKeyToInvisibleTable = {
  name: "FK_Orders_Regions",
  referencingTable: { schema: "sales", name: "Orders" },
  columns: ["RegionId"],
  onDelete: "noAction",
  onUpdate: "cascade",
  isEnabled: true,
};

function snapshotWith(
  foreignKeys: ForeignKey[],
  overrides: Partial<SchemaSnapshot> = {},
): SchemaSnapshot {
  return {
    databaseName: "Shop",
    serverVersion: null,
    extractedAt: "2026-10-16T08:00:00Z",
    access: ACCESS,
    tables: TABLES,
    views: [],
    foreignKeys,
    foreignKeysToInvisibleTables: [INVISIBLE],
    ...overrides,
  };
}

const SNAPSHOT = snapshotWith(Object.values(FOREIGN_KEYS));

/** The sentences of an explanation as message keys, a counted one with its count. */
type Outline = string | { whenEnabled: Outline[] } | { whenWritten: Outline[] };

function outline(nodes: readonly RuleNode[]): Outline[] {
  return nodes.map((node): Outline => {
    if (node.kind === "group") {
      return node.group.kind === "whenWritten"
        ? { whenWritten: outline(node.items) }
        : { whenEnabled: outline(node.items) };
    }
    return "key" in node.text ? node.text.key : `${node.text.plural}(${node.text.count})`;
  });
}

const translators: Readonly<Record<"en" | "es", RuleTranslator>> = {
  en: createCatalogTranslator(messageCatalogs.en, "en"),
  es: createCatalogTranslator(messageCatalogs.es, "es"),
};

function words(explanation: ForeignKeyExplanation, locale: "en" | "es"): string[] {
  const lines = (nodes: readonly RuleNode[]): string[] =>
    nodes.flatMap((node) => {
      const own = ruleTextToString(
        formatRuleText(node.kind === "sentence" ? node.text : node.heading, translators[locale]),
      );
      return node.kind === "sentence" ? [own] : [own, ...lines(node.items)];
    });
  return lines(explanation.rules);
}

function explain(foreignKey: ForeignKey, snapshot = SNAPSHOT): ForeignKeyExplanation {
  return explainForeignKey(foreignKey, snapshot);
}

/** A key from facts.Children to facts.Parents (Code, which can change) with the given actions. */
function childKey(
  columns: string[],
  actions: { onDelete?: ReferentialAction; onUpdate?: ReferentialAction },
): ForeignKey {
  return key("FK_Children_Parents", "facts.Children", columns, "facts.Parents", ["Code"], actions);
}

describe("explainForeignKey on the fixture's keys", () => {
  it("reads a required key to an identity parent that cascades its updates", () => {
    const explanation = explain(FOREIGN_KEYS.ordersCustomers);
    expect(explanation).toMatchObject({ optionality: "required", childCardinality: "many" });
    expect(outline(explanation.rules)).toEqual([
      "rule.fk.required",
      "rule.fk.parentMany",
      "rule.fk.delete.noAction",
      "rule.fk.update.identity",
    ]);
    expect(words(explanation, "en")).toEqual([
      "Each row in sales.Orders belongs to exactly one row in dbo.Customers",
      "A row in dbo.Customers can be referenced by any number of rows in sales.Orders, or by none",
      "Deleting a row in dbo.Customers is blocked if, once the statement has run, rows in sales.Orders still point to it",
      "CustomerId is an identity column and never changes, so ON UPDATE CASCADE has no effect",
    ]);
    expect(words(explanation, "es")).toEqual([
      "Cada fila de sales.Orders pertenece exactamente a una fila de dbo.Customers",
      "Una fila de dbo.Customers puede estar referenciada por cualquier número de filas de sales.Orders, o por ninguna",
      "Borrar una fila de dbo.Customers se bloquea si, al terminar la sentencia, aún hay filas de sales.Orders que la referencian",
      "CustomerId es una columna de identidad y nunca cambia, así que ON UPDATE CASCADE no tiene efecto",
    ]);
  });

  it("reads an optional key that empties its column, leaving out an update that never happens", () => {
    const explanation = explain(FOREIGN_KEYS.ordersEmployees);
    expect(explanation.optionality).toBe("optional");
    expect(outline(explanation.rules)).toEqual([
      "rule.fk.optional(1)",
      "rule.fk.parentMany",
      "rule.fk.delete.setNull",
    ]);
    expect(words(explanation, "en")).toEqual([
      "Each row in sales.Orders belongs to at most one row in hr.Employees, and to none when SalesRepId is NULL",
      "A row in hr.Employees can be referenced by any number of rows in sales.Orders, or by none",
      "Deleting a row in hr.Employees sets SalesRepId to NULL in the rows of sales.Orders that point to it",
    ]);
    expect(words(explanation, "es")[2]).toBe(
      "Al borrar una fila de hr.Employees, las filas de sales.Orders que la referenciaban quedan con SalesRepId en NULL",
    );
  });

  it("reads cascading deletes", () => {
    expect(outline(explain(FOREIGN_KEYS.orderLinesOrders).rules)).toEqual([
      "rule.fk.required",
      "rule.fk.parentMany",
      "rule.fk.delete.cascade",
    ]);
    expect(words(explain(FOREIGN_KEYS.customerTagsCustomers), "en")[2]).toBe(
      "Deleting a row in dbo.Customers also deletes the rows in dbo.CustomerTags that point to it",
    );
  });

  it("reads a composite key whose parent key can change", () => {
    const explanation = explain(FOREIGN_KEYS.shipmentsOrderLines);
    expect(outline(explanation.rules)).toEqual([
      "rule.fk.required",
      "rule.fk.parentMany",
      "rule.fk.delete.noAction",
      "rule.fk.update.noAction(2)",
    ]);
    expect(words(explanation, "en")[3]).toBe(
      "Changing OrderId and LineNumber of a row in sales.OrderLines is blocked if, once the statement has run, rows in sales.Shipments still point to its old values and no row in sales.OrderLines has them",
    );
    expect(words(explanation, "es")[3]).toBe(
      "Cambiar OrderId y LineNumber de una fila de sales.OrderLines se bloquea si, al terminar la sentencia, aún hay filas de sales.Shipments que referencian sus valores anteriores y ninguna fila de sales.OrderLines los tiene",
    );
  });

  it("reads a disabled key under 'When enabled:'", () => {
    const explanation = explain(FOREIGN_KEYS.shipmentsOrdersDisabled);
    expect(outline(explanation.rules)).toEqual([
      { whenEnabled: ["rule.fk.required", "rule.fk.parentMany", "rule.fk.delete.noAction"] },
    ]);
    expect(words(explanation, "en")[0]).toBe("When enabled:");
    expect(words(explanation, "es")[0]).toBe("Cuando se habilite:");
  });

  it("reads a self-reference, which a row may make to itself", () => {
    const explanation = explain(FOREIGN_KEYS.employeesManager);
    expect(outline(explanation.rules)).toEqual([
      "rule.fk.self.optional(1)",
      "rule.fk.self.parentMany",
      "rule.fk.self.delete.noAction",
    ]);
    expect(words(explanation, "en")).toEqual([
      "Each row in hr.Employees belongs to at most one row of the same table, which may be itself, and to none when ManagerId is NULL",
      "A row in hr.Employees can be referenced by any number of rows of the same table, or by none",
      "Deleting a row in hr.Employees is blocked if, once the statement has run, rows of the same table still point to it",
    ]);
    // Both sides are the same table, so both columns are highlighted on it.
    expect([...explanation.columns]).toEqual([["hr.Employees", ["ManagerId", "EmployeeId"]]]);
  });

  it("reads a self-reference whose key can change against the rows left once the statement has run", () => {
    // One statement may delete a row with the rows that point to it, re-key a row that points
    // to itself along with its own column, or swap two keys (pinned against the engine).
    const explanation = explain(FOREIGN_KEYS.nodesParent);
    expect(outline(explanation.rules)).toEqual([
      "rule.fk.self.optional(1)",
      "rule.fk.self.parentMany",
      "rule.fk.self.delete.noAction",
      "rule.fk.self.update.noAction(1)",
    ]);
    expect(words(explanation, "en").slice(2)).toEqual([
      "Deleting a row in facts.Nodes is blocked if, once the statement has run, rows of the same table still point to it",
      "Changing NodeId of a row in facts.Nodes is blocked if, once the statement has run, rows of the same table still point to its old value and no row has it",
    ]);
    expect(words(explanation, "es").slice(2)).toEqual([
      "Borrar una fila de facts.Nodes se bloquea si, al terminar la sentencia, aún hay filas de la misma tabla que la referencian",
      "Cambiar NodeId de una fila de facts.Nodes se bloquea si, al terminar la sentencia, aún hay filas de la misma tabla que referencian su valor anterior y ninguna fila lo tiene",
    ]);

    const composite = explain(FOREIGN_KEYS.foldersParent);
    expect(outline(composite.rules).at(-1)).toBe("rule.fk.self.update.noAction(2)");
    expect(words(composite, "en").at(-1)).toBe(
      "Changing TenantId and FolderId of a row in facts.Folders is blocked if, once the statement has run, rows of the same table still point to its old values and no row has them",
    );
    expect(words(composite, "es").at(-1)).toBe(
      "Cambiar TenantId y FolderId de una fila de facts.Folders se bloquea si, al terminar la sentencia, aún hay filas de la misma tabla que referencian sus valores anteriores y ninguna fila los tiene",
    );
  });

  it("hands out the ON DELETE sentence alone for a one-line label", () => {
    expect(
      ruleTextToString(
        formatRuleText(explain(FOREIGN_KEYS.ordersEmployees).deleteRule, translators.en),
      ),
    ).toBe(
      "Deleting a row in hr.Employees sets SalesRepId to NULL in the rows of sales.Orders that point to it",
    );
    // A disabled key's sentence is the same; its rules say it holds only once enabled.
    expect(explain(FOREIGN_KEYS.shipmentsOrdersDisabled).deleteRule).toEqual({
      key: "rule.fk.delete.noAction",
      args: expect.any(Object) as unknown,
    });
    expect(explainForeignKeyToInvisibleTable(INVISIBLE, SNAPSHOT).deleteRule).toMatchObject({
      key: "rule.fk.delete.noAction",
      args: { parent: { kind: "referencedTable" } },
    });
  });

  it("names the columns of both sides for highlighting", () => {
    expect([...explain(FOREIGN_KEYS.shipmentsOrderLines).columns]).toEqual([
      ["sales.Shipments", ["OrderId", "LineNumber"]],
      ["sales.OrderLines", ["OrderId", "LineNumber"]],
    ]);
  });
});

describe("explainForeignKey on optionality and cardinality", () => {
  it.each([
    ["the child's primary key is the key", FOREIGN_KEYS.orderNotesOrders, "atMostOne"],
    ["a unique constraint inside the key", FOREIGN_KEYS.accountsCustomers, "atMostOne"],
    ["a unique index, which may be filtered", FOREIGN_KEYS.cardsCustomers, "unknown"],
    ["a unique index wider than the key", FOREIGN_KEYS.ordersCustomers, "many"],
    ["a key part of a wider primary key", FOREIGN_KEYS.customerTagsCustomers, "many"],
  ] as const)("when %s", (_label, foreignKey, cardinality) => {
    const explanation = explain(foreignKey);
    expect(explanation.childCardinality).toBe(cardinality);
    const parentSide = outline(explanation.rules).filter(
      (entry) => typeof entry === "string" && entry.startsWith("rule.fk.parent"),
    );
    expect(parentSide).toEqual(
      { atMostOne: ["rule.fk.parentOne"], many: ["rule.fk.parentMany"], unknown: [] }[cardinality],
    );
  });

  it("words one-to-one keys", () => {
    expect(words(explain(FOREIGN_KEYS.orderNotesOrders), "en")[1]).toBe(
      "A row in sales.Orders can be referenced by at most one row in sales.OrderNotes",
    );
  });

  it("treats a composite key with any nullable column as optional", () => {
    const one = explain(FOREIGN_KEYS.childrenPairs);
    expect(one.optionality).toBe("optional");
    expect(outline(one.rules)[0]).toBe("rule.fk.optional(1)");
    expect(words(one, "en")[0]).toBe(
      "Each row in facts.Children belongs to at most one row in facts.Pairs, and to none when PairB is NULL",
    );
    const two = explain(
      key("FK_Children_Pairs3", "facts.Children", ["PairA", "PairB", "PairC"], "facts.Pairs", [
        "PairA",
        "PairB",
        "PairA",
      ]),
    );
    expect(outline(two.rules)[0]).toBe("rule.fk.optional(2)");
    expect(words(two, "en")[0]).toBe(
      "Each row in facts.Children belongs to at most one row in facts.Pairs, and to none when any of PairB and PairC is NULL",
    );
    expect(words(two, "es")[0]).toBe(
      "Cada fila de facts.Children pertenece como mucho a una fila de facts.Pairs, y a ninguna cuando alguna de las columnas PairB y PairC es NULL",
    );
  });

  it("does not guess when a referencing column is missing", () => {
    const explanation = explain(
      key("FK_Orders_Ghost", "sales.Orders", ["GhostId"], "dbo.Customers", ["CustomerId"]),
    );
    expect(explanation.optionality).toBe("unknown");
    expect(outline(explanation.rules)[0]).toBe("rule.fk.unknown");
    expect(words(explanation, "en")[0]).toBe(
      "Rows in sales.Orders refer to rows in dbo.Customers through GhostId",
    );
  });

  it("keeps the update sentence when the referenced table is not in the snapshot", () => {
    const projected = snapshotWith([FOREIGN_KEYS.ordersCustomers], {
      tables: TABLES.filter((entry) => entry.name.name !== "Customers"),
    });
    const explanation = explain(FOREIGN_KEYS.ordersCustomers, projected);
    // Without the parent's columns, nothing says its key is an identity.
    expect(outline(explanation.rules).at(-1)).toBe("rule.fk.update.cascade");
  });

  it("decides optionality from the referencing columns alone", () => {
    const orders = TABLES.find((entry) => entry.name.name === "Orders")?.columns ?? [];
    expect(foreignKeyOptionality(orders, FOREIGN_KEYS.ordersCustomers)).toBe("required");
    expect(foreignKeyOptionality(orders, FOREIGN_KEYS.ordersEmployees)).toBe("optional");
    expect(foreignKeyOptionality(orders, INVISIBLE)).toBe("optional");
    expect(foreignKeyOptionality([], FOREIGN_KEYS.ordersCustomers)).toBe("unknown");
    expect(foreignKeyChildCardinality(undefined, FOREIGN_KEYS.ordersCustomers)).toBe("unknown");
  });
});

describe("explainForeignKey on referential actions", () => {
  it.each([
    ["noAction", "rule.fk.delete.noAction"],
    ["cascade", "rule.fk.delete.cascade"],
    ["setNull", "rule.fk.delete.setNull"],
  ] as const)("reads ON DELETE %s", (action, sentenceKey) => {
    expect(outline(explain(childKey(["ParentCode"], { onDelete: action })).rules)).toContain(
      sentenceKey,
    );
  });

  it.each([
    ["noAction", "rule.fk.update.noAction(1)"],
    ["cascade", "rule.fk.update.cascade"],
    ["setNull", "rule.fk.update.setNull"],
  ] as const)("reads ON UPDATE %s on a key that can change", (action, sentenceKey) => {
    expect(outline(explain(childKey(["ParentCode"], { onUpdate: action })).rules).at(-1)).toBe(
      sentenceKey,
    );
  });

  it("words ON UPDATE NO ACTION against the rows left once the statement has run", () => {
    // Two parent rows can swap their keys in one statement (pinned against the engine).
    const explanation = explain(childKey(["ParentCode"], { onUpdate: "noAction" }));
    expect(words(explanation, "en").at(-1)).toBe(
      "Changing Code of a row in facts.Parents is blocked if, once the statement has run, rows in facts.Children still point to its old value and no row in facts.Parents has it",
    );
    expect(words(explanation, "es").at(-1)).toBe(
      "Cambiar Code de una fila de facts.Parents se bloquea si, al terminar la sentencia, aún hay filas de facts.Children que referencian su valor anterior y ninguna fila de facts.Parents lo tiene",
    );
  });

  it("words ON UPDATE SET NULL and CASCADE", () => {
    expect(words(explain(childKey(["ParentCode"], { onUpdate: "setNull" })), "en").at(-1)).toBe(
      "Changing Code of a row in facts.Parents sets ParentCode to NULL in the rows of facts.Children that pointed to it",
    );
    expect(words(explain(childKey(["ParentCode"], { onUpdate: "cascade" })), "es").at(-1)).toBe(
      "Cambiar Code de una fila de facts.Parents cambia también ParentCode en las filas de facts.Children que la referencian",
    );
  });

  it.each([
    ["cascade", "CASCADE"],
    ["setNull", "SET NULL"],
    ["setDefault", "SET DEFAULT"],
  ] as const)("says ON UPDATE %s never runs on an identity key", (action, keyword) => {
    const explanation = explain(
      key("FK_Orders_Customers", "sales.Orders", ["CustomerId"], "dbo.Customers", ["CustomerId"], {
        onUpdate: action,
      }),
    );
    expect(words(explanation, "en").at(-1)).toBe(
      `CustomerId is an identity column and never changes, so ON UPDATE ${keyword} has no effect`,
    );
  });

  it("names the default a column falls back to on SET DEFAULT, with each variant", () => {
    const withDefault = explain(childKey(["WithDefault"], { onDelete: "setDefault" }));
    expect(outline(withDefault.rules)).toContain("rule.fk.delete.setDefault(1)");
    // The delete sentence comes before the update one.
    expect(words(withDefault, "en").at(-2)).toBe(
      "Deleting a row in facts.Parents sets WithDefault to its default value in the rows of facts.Children that point to it; the delete is blocked unless another row in facts.Parents has that value",
    );
    const twoDefaults = explain(
      key(
        "FK_Children_Pairs",
        "facts.Children",
        ["WithDefault", "OtherDefault"],
        "facts.Pairs",
        ["PairA", "PairB"],
        { onDelete: "setDefault" },
      ),
    );
    expect(outline(twoDefaults.rules)).toContain("rule.fk.delete.setDefault(2)");

    const noDefault = explain(childKey(["ParentCode"], { onDelete: "setDefault" }));
    expect(outline(noDefault.rules)).toContain("rule.fk.delete.setDefaultNull(1)");
    expect(words(noDefault, "es").at(-2)).toBe(
      "Al borrar una fila de facts.Parents, las filas de facts.Children que la referenciaban quedan con ParentCode en NULL, porque no tiene valor por defecto",
    );
    // A DEFAULT (NULL) is no value to point to either.
    expect(outline(explain(childKey(["NullDefault"], { onDelete: "setDefault" })).rules)).toContain(
      "rule.fk.delete.setDefaultNull(1)",
    );
  });

  it("stays neutral on SET DEFAULT when the defaults are not all known", () => {
    for (const columns of [["HiddenDefault"], ["WithDefault", "ParentCode"]]) {
      expect(
        outline(
          explain(childKey(columns, { onDelete: "setDefault", onUpdate: "setDefault" })).rules,
        ).slice(-2),
      ).toEqual([
        `rule.fk.delete.setDefaultNeutral(${columns.length})`,
        `rule.fk.update.setDefaultNeutral(${columns.length})`,
      ]);
    }
    // A 1.0 file did not record defaults, so a missing one may exist.
    const formatOne = snapshotWith([], { access: undefined });
    delete formatOne.access;
    expect(
      outline(explain(childKey(["ParentCode"], { onDelete: "setDefault" }), formatOne).rules),
    ).toContain("rule.fk.delete.setDefaultNeutral(1)");
    // A default kept from an earlier read may have changed since.
    const carried = snapshotWith([], {
      carriedOver: [
        {
          object: { schema: "facts", name: "Children" },
          fact: { kind: "columnDefault", column: "WithDefault" },
          readAt: "2026-10-01T08:00:00Z",
        },
      ],
    });
    expect(
      outline(explain(childKey(["WithDefault"], { onDelete: "setDefault" }), carried).rules),
    ).toContain("rule.fk.delete.setDefaultNeutral(1)");
  });

  it("takes what travels beside an exported snapshot, so the viewer says what the app says", () => {
    // An HTML export embeds the snapshot without its access profile and kept facts.
    const exported = snapshotWith([childKey(["ParentCode"], { onDelete: "setDefault" })], {
      access: undefined,
    });
    delete exported.access;
    const [exportedKey] = exported.foreignKeys;
    if (exportedKey === undefined) {
      throw new Error("no key");
    }
    const scope = { hasAccessProfile: true, carriedOver: [] };
    expect(outline(explainForeignKey(exportedKey, exported, scope).rules)).toContain(
      "rule.fk.delete.setDefaultNull(1)",
    );
    expect(foreignKeyExplanation(exported, exportedKey, scope)).toEqual(
      explainForeignKey(exportedKey, SNAPSHOT),
    );
    // A different scope for the same snapshot is not answered from the other's cache.
    expect(outline(foreignKeyExplanation(exported, exportedKey).rules)).toContain(
      "rule.fk.delete.setDefaultNeutral(1)",
    );
  });

  it("words ON UPDATE SET DEFAULT with its block", () => {
    expect(words(explain(childKey(["WithDefault"], { onUpdate: "setDefault" })), "en").at(-1)).toBe(
      "Changing Code of a row in facts.Parents sets WithDefault to its default value in the rows of facts.Children that pointed to it; the change is blocked unless, after it, a row in facts.Parents has that value",
    );
  });
});

describe("explainForeignKeyToInvisibleTable", () => {
  const explanation = explainForeignKeyToInvisibleTable(INVISIBLE, SNAPSHOT);

  it("says what the local columns reveal and nothing about the hidden side", () => {
    expect(explanation).toMatchObject({
      optionality: "optional",
      childCardinality: null,
      sql: null,
    });
    expect(outline(explanation.rules)).toEqual([
      "rule.fk.invisible.optional(1)",
      "rule.fk.delete.noAction",
      "rule.fk.update.cascade",
    ]);
    expect([...explanation.columns]).toEqual([["sales.Orders", ["RegionId"]]]);
  });

  it("words the actions against the referenced table", () => {
    expect(words(explanation, "en")).toEqual([
      "Each row in sales.Orders belongs to at most one row in a table not visible to this login, and to none when RegionId is NULL",
      "Deleting a row in the referenced table is blocked if, once the statement has run, rows in sales.Orders still point to it",
      "Changing the referenced key of a row in the referenced table also changes RegionId in the rows of sales.Orders that point to it",
    ]);
    expect(words(explanation, "es")).toEqual([
      "Cada fila de sales.Orders pertenece como mucho a una fila de una tabla no visible para este inicio de sesión, y a ninguna cuando RegionId es NULL",
      "Borrar una fila de la tabla referenciada se bloquea si, al terminar la sentencia, aún hay filas de sales.Orders que la referencian",
      "Cambiar la clave referenciada de una fila de la tabla referenciada cambia también RegionId en las filas de sales.Orders que la referencian",
    ]);
  });

  it("reads a required or disabled key the same way", () => {
    const required = explainForeignKeyToInvisibleTable(
      { ...INVISIBLE, columns: ["CustomerId"], onUpdate: "noAction", isEnabled: false },
      SNAPSHOT,
    );
    expect(outline(required.rules)).toEqual([
      {
        whenEnabled: [
          "rule.fk.invisible.required",
          "rule.fk.delete.noAction",
          "rule.fk.update.noAction(1)",
        ],
      },
    ]);
    const unknown = explainForeignKeyToInvisibleTable(
      { ...INVISIBLE, columns: ["Ghost"] },
      SNAPSHOT,
    );
    expect(outline(unknown.rules)[0]).toBe("rule.fk.invisible.unknown");
  });
});

describe("foreignKeyDefinitionSql", () => {
  it("scripts the key, leaving out NO ACTION", () => {
    expect(foreignKeyDefinitionSql(FOREIGN_KEYS.ordersCustomers)).toBe(
      [
        "ALTER TABLE [sales].[Orders] ADD CONSTRAINT [FK_Orders_Customers]",
        "  FOREIGN KEY ([CustomerId]) REFERENCES [dbo].[Customers] ([CustomerId])",
        "  ON UPDATE CASCADE;",
      ].join("\n"),
    );
    expect(foreignKeyDefinitionSql(FOREIGN_KEYS.shipmentsOrderLines)).toBe(
      [
        "ALTER TABLE [sales].[Shipments] ADD CONSTRAINT [FK_Shipments_OrderLines]",
        "  FOREIGN KEY ([OrderId], [LineNumber]) REFERENCES [sales].[OrderLines] ([OrderId], [LineNumber]);",
      ].join("\n"),
    );
  });

  it("disables a disabled key and doubles closing brackets", () => {
    const odd = key("FK_Odd]Name", "dbo.Odd]Table", ["A]1"], "dbo.Parent", ["B"], {
      onDelete: "setDefault",
      onUpdate: "setNull",
      isEnabled: false,
    });
    expect(foreignKeyDefinitionSql(odd)).toBe(
      [
        "ALTER TABLE [dbo].[Odd]]Table] WITH NOCHECK ADD CONSTRAINT [FK_Odd]]Name]",
        "  FOREIGN KEY ([A]]1]) REFERENCES [dbo].[Parent] ([B])",
        "  ON DELETE SET DEFAULT",
        "  ON UPDATE SET NULL;",
        "ALTER TABLE [dbo].[Odd]]Table] NOCHECK CONSTRAINT [FK_Odd]]Name];",
      ].join("\n"),
    );
    expect(explain(FOREIGN_KEYS.ordersCustomers).sql).toBe(
      foreignKeyDefinitionSql(FOREIGN_KEYS.ordersCustomers),
    );
  });
});

describe("foreignKeyChildCardinality on the state of the keys and indexes behind it", () => {
  type State = Pick<Index, "isEnabled" | "isFiltered">;
  const states: readonly State[] = [true, false, undefined].flatMap((isEnabled) =>
    [true, false, undefined].map((isFiltered) => ({
      ...(isEnabled === undefined ? {} : { isEnabled }),
      ...(isFiltered === undefined ? {} : { isFiltered }),
    })),
  );
  const cardsKey = FOREIGN_KEYS.cardsCustomers;
  /**
   * sales.Cards with its key column covered by one primary key, unique constraint or unique
   * index, clustered or not.
   */
  function cards(
    holder: "primaryKey" | "uniqueConstraint" | "uniqueIndex",
    state: State,
    isClustered = false,
  ): Table {
    const base = table("sales.Cards", [column("CardId"), column("CustomerId")], ["CardId"]);
    if (holder === "primaryKey") {
      return {
        ...base,
        primaryKey: {
          name: "PK_Cards",
          columns: ["CustomerId"],
          isClustered,
          ...(state.isEnabled === undefined ? {} : { isEnabled: state.isEnabled }),
        },
      };
    }
    return {
      ...base,
      primaryKey: { name: "PK_Cards", columns: ["CardId"], isClustered: !isClustered },
      indexes: [{ ...index("UX_Cards_Customer", holder, ["CustomerId"], state), isClustered }],
    };
  }

  it.each(states)(
    "reads a primary key, a unique constraint and a unique index that are %o",
    (state) => {
      // A primary key and a unique constraint hold unless recorded as disabled, as 1.1 read them;
      // a unique index holds only when recorded as enabled and without a filter. A filter limits
      // only the rows it selects, so it, or a state not recorded, leaves it unknown.
      const constraint =
        state.isEnabled === false ? "many" : state.isFiltered === true ? "unknown" : "atMostOne";
      const uniqueIndex =
        state.isEnabled === false
          ? "many"
          : state.isEnabled === true && state.isFiltered === false
            ? "atMostOne"
            : "unknown";
      expect(foreignKeyChildCardinality(cards("primaryKey", state), cardsKey)).toBe(
        state.isEnabled === false ? "many" : "atMostOne",
      );
      expect(foreignKeyChildCardinality(cards("uniqueConstraint", state), cardsKey)).toBe(
        constraint,
      );
      expect(foreignKeyChildCardinality(cards("uniqueIndex", state), cardsKey)).toBe(uniqueIndex);
      // A disabled clustered one takes no row, and SQL Server keeps the key disabled until it is
      // rebuilt, which makes it unique again: by the time the key can be enabled, it holds.
      expect(foreignKeyChildCardinality(cards("primaryKey", state, true), cardsKey)).toBe(
        "atMostOne",
      );
      if (state.isEnabled === false) {
        for (const holder of ["uniqueConstraint", "uniqueIndex"] as const) {
          expect(foreignKeyChildCardinalityReading(cards(holder, state, true), cardsKey)).toEqual({
            cardinality: "atMostOne",
            disabled: [],
            filtered: [],
          });
        }
      }
    },
  );

  it("names the disabled nonclustered indexes, which a rebuild of the clustered one leaves disabled", () => {
    const disabledClusteredPk = (keyColumn: string): Table => ({
      ...table("sales.Cards", [column("CardId"), column("CustomerId")], null),
      primaryKey: { name: "PK_Cards", columns: [keyColumn], isClustered: true, isEnabled: false },
      indexes: [
        index("UX_Cards_Customer", "uniqueIndex", ["CustomerId"], {
          isEnabled: false,
          isFiltered: false,
        }),
      ],
    });
    expect(foreignKeyChildCardinalityReading(disabledClusteredPk("CardId"), cardsKey)).toEqual({
      cardinality: "many",
      disabled: ["UX_Cards_Customer"],
      filtered: [],
    });
    expect(foreignKeyChildCardinalityReading(disabledClusteredPk("CustomerId"), cardsKey)).toEqual({
      cardinality: "atMostOne",
      disabled: ["UX_Cards_Customer"],
      filtered: [],
    });
  });

  it("is at most one when any of them holds, and many only when every one is disabled", () => {
    const withIndexes = (indexes: Index[]) => ({
      ...table("sales.Cards", [column("CardId"), column("CustomerId")], ["CardId"]),
      indexes,
    });
    const disabled = { isEnabled: false, isFiltered: false };
    const holds = { isEnabled: true, isFiltered: false };
    const filtered = { isEnabled: true, isFiltered: true };
    expect(
      foreignKeyChildCardinalityReading(
        withIndexes([
          index("UQ_A", "uniqueConstraint", ["CustomerId"], disabled),
          index("UX_B", "uniqueIndex", ["CustomerId"], holds),
        ]),
        cardsKey,
      ),
    ).toEqual({ cardinality: "atMostOne", disabled: ["UQ_A"], filtered: [] });
    expect(
      foreignKeyChildCardinalityReading(
        withIndexes([
          index("UQ_A", "uniqueConstraint", ["CustomerId"], disabled),
          index("UX_B", "uniqueIndex", ["CustomerId"], disabled),
        ]),
        cardsKey,
      ),
    ).toEqual({ cardinality: "many", disabled: ["UQ_A", "UX_B"], filtered: [] });
    expect(
      foreignKeyChildCardinalityReading(
        withIndexes([
          index("UQ_A", "uniqueConstraint", ["CustomerId"], disabled),
          index("UX_B", "uniqueIndex", ["CustomerId"], filtered),
        ]),
        cardsKey,
      ),
    ).toEqual({ cardinality: "unknown", disabled: ["UQ_A"], filtered: ["UX_B"] });
    // An index wider than the key, or one that is not unique, never counts.
    expect(
      foreignKeyChildCardinalityReading(
        withIndexes([
          index("UX_Wide", "uniqueIndex", ["CustomerId", "CardId"], holds),
          index("IX_Plain", "nonUnique", ["CustomerId"], disabled),
        ]),
        cardsKey,
      ),
    ).toEqual({ cardinality: "many", disabled: [], filtered: [] });
  });
});

describe("explainForeignKey on the indexes that do not hold", () => {
  const cardsKey = FOREIGN_KEYS.cardsCustomers;
  function explainWith(indexes: Index[], foreignKey: ForeignKey = cardsKey) {
    const tables = TABLES.map((entry) =>
      entry.name.name === "Cards" || entry.name.name === "Nodes" ? { ...entry, indexes } : entry,
    );
    return explain(foreignKey, snapshotWith([foreignKey], { tables }));
  }
  const parentLines = (explanation: ForeignKeyExplanation, locale: "en" | "es") =>
    words(explanation, locale).filter((line) => /^(A row in|Una fila de) /u.test(line));

  it("names the disabled index that is why a row can be referenced by many", () => {
    const explanation = explainWith([
      index("UQ_Cards_Customer", "uniqueConstraint", ["CustomerId"], { isEnabled: false }),
    ]);
    expect(explanation.childCardinality).toBe("many");
    expect(outline(explanation.rules)).toContain("rule.fk.parentManyDisabled(1)");
    expect(parentLines(explanation, "en")).toEqual([
      "A row in dbo.Customers can be referenced by any number of rows in sales.Cards, or by none, because the index UQ_Cards_Customer is disabled",
    ]);
    expect(parentLines(explanation, "es")).toEqual([
      "Una fila de dbo.Customers puede estar referenciada por cualquier número de filas de sales.Cards, o por ninguna, porque el índice UQ_Cards_Customer está deshabilitado",
    ]);

    const two = explainWith([
      index("UQ_Cards_Customer", "uniqueConstraint", ["CustomerId"], { isEnabled: false }),
      index("UX_Cards_Customer", "uniqueIndex", ["CustomerId"], {
        isEnabled: false,
        isFiltered: false,
      }),
    ]);
    expect(parentLines(two, "en")).toEqual([
      "A row in dbo.Customers can be referenced by any number of rows in sales.Cards, or by none, because the indexes UQ_Cards_Customer and UX_Cards_Customer are disabled",
    ]);
    expect(parentLines(two, "es")).toEqual([
      "Una fila de dbo.Customers puede estar referenciada por cualquier número de filas de sales.Cards, o por ninguna, porque los índices UQ_Cards_Customer y UX_Cards_Customer están deshabilitados",
    ]);
  });

  it("says a filtered unique index limits only the rows its filter selects, never at most one", () => {
    const explanation = explainWith([
      index("UX_Cards_Current", "uniqueIndex", ["CustomerId"], {
        isEnabled: true,
        isFiltered: true,
      }),
    ]);
    expect(explanation.childCardinality).toBe("unknown");
    expect(outline(explanation.rules)).toContain("rule.fk.parentFiltered");
    expect(outline(explanation.rules)).not.toContain("rule.fk.parentOne");
    expect(parentLines(explanation, "en")).toEqual([
      "A row in dbo.Customers can be referenced by at most one of the rows in sales.Cards that the filter of the unique index UX_Cards_Current selects",
    ]);
    expect(parentLines(explanation, "es")).toEqual([
      "Una fila de dbo.Customers puede estar referenciada como mucho por una de las filas de sales.Cards que selecciona el filtro del índice único UX_Cards_Current",
    ]);
    // A unique index whose state was not recorded says nothing, as in 1.1.
    expect(
      parentLines(explainWith([index("UX_Cards_Current", "uniqueIndex", ["CustomerId"])]), "en"),
    ).toEqual([]);
  });

  it("says the same of a self-reference", () => {
    const nodes = (state: Pick<Index, "isEnabled" | "isFiltered">) =>
      explainWith(
        [index("UX_Nodes_Parent", "uniqueIndex", ["ParentNodeId"], state)],
        FOREIGN_KEYS.nodesParent,
      );
    expect(parentLines(nodes({ isEnabled: false, isFiltered: false }), "en")).toEqual([
      "A row in facts.Nodes can be referenced by any number of rows of the same table, or by none, because the index UX_Nodes_Parent is disabled",
    ]);
    expect(parentLines(nodes({ isEnabled: true, isFiltered: true }), "es")).toEqual([
      "Una fila de facts.Nodes puede estar referenciada como mucho por una de las filas de la misma tabla que selecciona el filtro del índice único UX_Nodes_Parent",
    ]);
    expect(parentLines(nodes({ isEnabled: true, isFiltered: false }), "en")).toEqual([
      "A row in facts.Nodes can be referenced by at most one row of the same table",
    ]);
  });

  it("draws the index names as code", () => {
    const explanation = explainWith([
      index("UQ_Cards_Customer", "uniqueConstraint", ["CustomerId"], { isEnabled: false }),
    ]);
    const parent = explanation.rules.find(
      (node) => node.kind === "sentence" && "plural" in node.text,
    );
    expect(
      parent?.kind === "sentence" && formatRuleText(parent.text, translators.en).at(-1),
    ).toEqual({ kind: "text", text: " is disabled" });
    expect(
      parent?.kind === "sentence" && formatRuleText(parent.text, translators.en).at(-2),
    ).toEqual({ kind: "code", text: "UQ_Cards_Customer" });
  });
});

describe("explainForeignKey on a key SQL Server marks as not trusted", () => {
  const untrusted = { ...FOREIGN_KEYS.orderLinesOrders, isTrusted: false };

  it("says the rows already there may not follow it, then words its rules for the rows written", () => {
    const explanation = explain(untrusted);
    // Only the referencing rows depend on trust, and an UPDATE is checked only when it writes a
    // referencing column; the sentences about the referenced table hold for every row.
    expect(outline(explanation.rules)).toEqual([
      "rule.trust.notVerified",
      { whenWritten: ["rule.fk.required"] },
      "rule.fk.parentMany",
      "rule.fk.delete.cascade",
    ]);
    expect(explanation.rules[1]).toMatchObject({
      group: { kind: "whenWritten", rule: "foreignKey", columns: ["OrderId"] },
    });
    expect(words(explanation, "en")).toEqual([
      "Rows already in sales.OrderLines may not follow this rule: SQL Server marks it as not trusted",
      "When a row is inserted or its OrderId is changed:",
      "Each row in sales.OrderLines belongs to exactly one row in sales.Orders",
      "A row in sales.Orders can be referenced by any number of rows in sales.OrderLines, or by none",
      "Deleting a row in sales.Orders also deletes the rows in sales.OrderLines that point to it",
    ]);
    expect(words(explanation, "es").slice(0, 2)).toEqual([
      "Las filas que ya hay en sales.OrderLines pueden no cumplir esta regla: SQL Server la marca como no confiable",
      "Cuando se inserta una fila o se modifica su OrderId:",
    ]);
    // The one-line label of the relationship keeps its delete sentence.
    expect(explanation.deleteRule).toMatchObject({ key: "rule.fk.delete.cascade" });
  });

  it("adds nothing for a trusted key or one whose trust was not recorded", () => {
    const plain = outline(explain(FOREIGN_KEYS.orderLinesOrders).rules);
    expect(outline(explain({ ...FOREIGN_KEYS.orderLinesOrders, isTrusted: true }).rules)).toEqual(
      plain,
    );
    expect(plain[0]).toBe("rule.fk.required");
  });

  it("reads a disabled key, never trusted, under 'When enabled:' alone", () => {
    const disabled = { ...FOREIGN_KEYS.shipmentsOrdersDisabled, isTrusted: false };
    expect(outline(explain(disabled).rules)).toEqual([
      { whenEnabled: ["rule.fk.required", "rule.fk.parentMany", "rule.fk.delete.noAction"] },
    ]);
  });

  it("says it of a key to a table the login cannot see as well", () => {
    const explanation = explainForeignKeyToInvisibleTable(
      { ...INVISIBLE, isTrusted: false },
      SNAPSHOT,
    );
    expect(outline(explanation.rules)).toEqual([
      "rule.trust.notVerified",
      { whenWritten: ["rule.fk.invisible.optional(1)"] },
      "rule.fk.delete.noAction",
      "rule.fk.update.cascade",
    ]);
    expect(words(explanation, "en")[0]).toBe(
      "Rows already in sales.Orders may not follow this rule: SQL Server marks it as not trusted",
    );
  });

  it("scripts it WITH NOCHECK and leaves it enabled", () => {
    expect(foreignKeyDefinitionSql(untrusted)).toBe(
      [
        "ALTER TABLE [sales].[OrderLines] WITH NOCHECK ADD CONSTRAINT [FK_OrderLines_Orders]",
        "  FOREIGN KEY ([OrderId]) REFERENCES [sales].[Orders] ([OrderId])",
        "  ON DELETE CASCADE;",
      ].join("\n"),
    );
    expect(foreignKeyDefinitionSql({ ...FOREIGN_KEYS.orderLinesOrders, isTrusted: true })).toBe(
      foreignKeyDefinitionSql(FOREIGN_KEYS.orderLinesOrders),
    );
  });
});

describe("foreignKeyExplanations", () => {
  it("explains every key of a snapshot once and keeps the result for it", () => {
    const explanations = foreignKeyExplanations(SNAPSHOT);
    expect(foreignKeyExplanations(SNAPSHOT)).toBe(explanations);
    expect(explanations.size).toBe(SNAPSHOT.foreignKeys.length + 1);
    expect(explanations.get(FOREIGN_KEYS.ordersEmployees)).toEqual(
      explain(FOREIGN_KEYS.ordersEmployees),
    );
    expect(explanations.get(INVISIBLE)).toEqual(
      explainForeignKeyToInvisibleTable(INVISIBLE, SNAPSHOT),
    );
    expect(foreignKeyExplanation(SNAPSHOT, FOREIGN_KEYS.ordersEmployees)).toBe(
      explanations.get(FOREIGN_KEYS.ordersEmployees),
    );
    // A key from another snapshot, such as a projected copy, is explained against this one.
    const copy = { ...FOREIGN_KEYS.ordersEmployees };
    expect(foreignKeyExplanation(SNAPSHOT, copy)).toEqual(explain(copy));
  });

  it("shares the result between scopes that each bring an empty list of kept facts", () => {
    // The canvas asks with the snapshot's own scope and the Inspector with one it builds, each
    // with an empty list of its own; neither must work every key out again for the other.
    const snapshot = snapshotWith(Object.values(FOREIGN_KEYS));
    const explanations = foreignKeyExplanations(snapshot);
    expect(foreignKeyExplanations(snapshot, { hasAccessProfile: true, carriedOver: [] })).toBe(
      explanations,
    );
    expect(foreignKeyExplanations(snapshot, { hasAccessProfile: false, carriedOver: [] })).not.toBe(
      explanations,
    );
  });

  it("formats every sentence of every key in both languages without a placeholder left", () => {
    for (const explanation of foreignKeyExplanations(SNAPSHOT).values()) {
      for (const locale of ["en", "es"] as const) {
        for (const line of words(explanation, locale)) {
          expect(line).not.toMatch(/[{}]/u);
        }
      }
    }
  });

  it("draws tables as chips and columns of their own entity", () => {
    const [belongsTo] = explain(FOREIGN_KEYS.ordersEmployees).rules;
    expect(
      belongsTo?.kind === "sentence" && formatRuleText(belongsTo.text, translators.en),
    ).toEqual([
      { kind: "text", text: "Each row in " },
      { kind: "table", key: "sales.Orders", label: "sales.Orders" },
      { kind: "text", text: " belongs to at most one row in " },
      { kind: "table", key: "hr.Employees", label: "hr.Employees" },
      { kind: "text", text: ", and to none when " },
      { kind: "column", entity: "sales.Orders", name: "SalesRepId" },
      { kind: "text", text: " is NULL" },
    ]);
  });
});
