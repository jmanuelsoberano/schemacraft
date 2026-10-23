import { describe, expect, it } from "vitest";

import { relationEnds } from "@/features/canvas/graph";
import { visibleProjection } from "@/features/export/html/viewerData";
import type {
  CanvasState,
  Column,
  ForeignKey,
  PostgresqlConstraint,
  PostgresqlIndex,
  SchemaSnapshot,
} from "@/shared/contracts";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";

import { entityKey } from "@/features/schema/entities";
import { describeModuleDetails, describeViewDefinition } from "@/features/schema/moduleDetails";
import { presentModuleDefinition, presentModuleDetails } from "@/features/schema/moduleDetailsView";
import { describeObjectDetails } from "@/features/schema/objectDetails";
import type { DetailsScope } from "@/features/schema/objectDetails";
import { presentObjectDetails } from "@/features/schema/objectDetailsView";
import { explainForeignKey } from "@/features/schema/rules/foreignKeyReader";

const child = { schema: "sales", name: "child" };
const parent = { schema: "sales", name: "parent" };
const materialized = { schema: "sales", name: "totals" };
const hidden = { schema: "private", name: "HIDDEN_OBJECT_SENTINEL" };
const routine = {
  kind: "routineOverload" as const,
  name: { schema: "sales", name: "total" },
  argumentTypes: [{ schema: "pg_catalog", name: "int4" }],
};
const trigger = { kind: "trigger" as const, parent: child, name: "before_change" };
const readable = (text: string) => ({ status: "readable" as const, text });
const column = (name: string, isNullable: boolean, position = 1): Column => ({
  name,
  ordinalPosition: position,
  dataType: {
    name: "int4",
    nativeDeclaration: "integer",
    precision: null,
    scale: null,
    length: null,
    userDefinedTypeName: null,
  },
  isNullable,
  defaultExpression: null,
  isIdentity: false,
  isComputed: false,
});
const fk: ForeignKey = {
  name: "fk_full",
  referencingTable: child,
  referencedTable: parent,
  columnPairs: [
    { referencingColumn: "tenant", referencedColumn: "tenant" },
    { referencingColumn: "code", referencedColumn: "code" },
  ],
  onDelete: "restrict",
  onUpdate: "noAction",
  isEnabled: true,
};
const constraint = (name = "fk_full"): PostgresqlConstraint => ({
  table: child,
  name,
  kind: "foreignKey",
  definition: readable(
    "FOREIGN KEY (tenant, code) REFERENCES sales.parent(tenant, code) MATCH FULL ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED",
  ),
  isValidated: false,
  isEnforced: null,
  isDeferrable: true,
  isInitiallyDeferred: true,
  matchType: "full",
  deleteSetColumns: [],
});
const index = (): PostgresqlIndex => ({
  table: child,
  name: { schema: "sales", name: "ux_child" },
  method: "btree",
  definition: readable(
    "CREATE UNIQUE INDEX ux_child ON sales.child (tenant, code) NULLS NOT DISTINCT INCLUDE (amount)",
  ),
  keyTerms: ["tenant", "code"],
  keyColumns: ["tenant", "code"],
  includedColumns: ["amount"],
  predicate: null,
  isUnique: true,
  isValid: true,
  isReady: true,
  isLive: true,
  nullsNotDistinct: true,
  wasClustered: true,
  constraint: null,
});

function snapshot(): SchemaSnapshot {
  return {
    provider: "postgreSql",
    databaseName: "Synthetic",
    serverVersion: "PostgreSQL 18",
    extractedAt: "2026-10-23T12:00:00Z",
    tables: [
      {
        name: child,
        columns: [
          column("tenant", false),
          column("code", true, 2),
          { ...column("amount", true, 3), isComputed: true },
        ],
        primaryKey: null,
        indexes: [
          {
            name: "ux_child",
            columns: ["tenant", "code"],
            kind: "uniqueIndex",
            includedColumns: ["amount"],
            isClustered: false,
            isFiltered: false,
          },
        ],
        checkConstraints: [
          { name: "positive", expression: readable("amount > 0"), isEnabled: null },
        ],
      },
      {
        name: parent,
        columns: [column("tenant", false), column("code", false, 2)],
        primaryKey: null,
        indexes: [],
        checkConstraints: [],
      },
      {
        name: hidden,
        columns: [column("tenant", false)],
        primaryKey: null,
        indexes: [],
        checkConstraints: [],
      },
    ],
    views: [{ name: materialized, columns: [column("sum", true)] }],
    foreignKeys: [fk, { ...fk, name: "fk_hidden", referencedTable: hidden }],
    programmability: {
      capture: { objects: { status: "read" }, definitions: { status: "read" } },
      views: [
        {
          view: materialized,
          definition: readable("SELECT sum(amount) FROM sales.child"),
          hasCheckOption: false,
          isIndexed: false,
        },
      ],
      routines: [
        {
          name: routine.name,
          identityArguments: routine.argumentTypes,
          kind: "tableFunction",
          parameters: [
            {
              name: "",
              ordinalPosition: 1,
              dataType: column("a", false).dataType,
              isOutput: false,
              isReadOnly: false,
            },
          ],
          returns: null,
          columns: [],
          body: {
            language: "postgreSql",
            name: "plpgsql",
            definition: readable("ROUTINE_BODY_SENTINEL"),
          },
        },
      ],
      triggers: [
        {
          parent: child,
          name: trigger.name,
          timing: "before",
          events: [
            { event: "update", order: "unspecified" },
            { event: "truncate", order: "unspecified" },
          ],
          isEnabled: true,
          isNotForReplication: false,
          body: {
            language: "postgreSql",
            name: "sql",
            definition: readable("TRIGGER_BODY_SENTINEL"),
          },
        },
      ],
    },
    postgresql: {
      tables: [
        { name: child, kind: "partitioned" },
        { name: parent, kind: "ordinary" },
        { name: hidden, kind: "ordinary" },
      ],
      columns: [
        {
          object: child,
          name: "amount",
          typeName: { schema: "pg_catalog", name: "numeric" },
          typeKind: "base",
          identityGeneration: null,
          generation: "stored",
          generationExpression: readable("tenant * 2"),
        },
      ],
      views: [
        { name: materialized, isMaterialized: true, isPopulated: false, checkOption: "none" },
      ],
      indexes: [
        index(),
        {
          ...index(),
          table: materialized,
          name: { schema: "sales", name: "ix_totals" },
          keyTerms: ["sum"],
          keyColumns: ["sum"],
          includedColumns: [],
        },
      ],
      constraints: [
        constraint(),
        {
          ...constraint("positive"),
          kind: "check",
          definition: readable("CHECK (amount > 0)"),
          matchType: null,
        },
        {
          ...constraint("exclude_values"),
          kind: "exclusion",
          definition: readable("EXCLUDE USING gist (amount WITH =)"),
          matchType: null,
        },
        {
          ...constraint("fk_hidden"),
          definition: readable("REFERENCES private.HIDDEN_OBJECT_SENTINEL"),
        },
      ],
      routines: [
        {
          object: routine,
          language: "plpgsql",
          returnsSet: true,
          arguments: null,
          result: "SETOF integer",
          argumentModes: ["i"],
          definitionIsReconstructed: true,
        },
      ],
      triggers: [
        {
          object: trigger,
          function: {
            ...routine,
            name: { schema: "private", name: "OFF_DIAGRAM_FUNCTION_SENTINEL" },
          },
          level: "statement",
          enabledMode: "replica",
          isConstraint: true,
          isDeferrable: true,
          isInitiallyDeferred: false,
          updateColumns: ["amount"],
        },
      ],
    },
  };
}

const scope: DetailsScope = {
  hiddenKeys: new Set(),
  coverage: null,
  carriedOver: [],
  isSchemaFiltered: false,
  isDiagramOnly: false,
  definitions: "included",
};
const canvas: CanvasState = {
  detailLevel: "full",
  layout: "manual",
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [child, parent, materialized, hidden].map((name) => ({
    name,
    position: { x: 0, y: 0 },
    isCollapsed: false,
    isHidden: name === hidden,
  })),
};

describe("PostgreSQL metadata presentation", () => {
  it("uses MATCH FULL and only usable simple unfiltered unique indexes for relationship markers", () => {
    const value = snapshot();
    expect(explainForeignKey(fk, value)).toMatchObject({
      native: true,
      optionality: "required",
      childCardinality: "atMostOne",
    });
    expect(relationEnds(value.tables[0], fk, value)).toEqual({ start: "zeroOrOne", end: "one" });
    for (const change of [
      { isValid: false },
      { isReady: false },
      { isLive: false },
      { predicate: readable("tenant > 0") },
      { keyColumns: ["tenant", null] },
    ]) {
      const native = value.postgresql;
      if (native === undefined) throw new Error("native fixture");
      expect(
        explainForeignKey(fk, {
          ...value,
          postgresql: { ...native, indexes: [{ ...index(), ...change }] },
        }).childCardinality,
      ).toBe("many");
    }
    const native = value.postgresql;
    if (native === undefined) throw new Error("native fixture");
    expect(
      explainForeignKey(fk, {
        ...value,
        postgresql: { ...native, constraints: [{ ...constraint(), matchType: "simple" }] },
      }).optionality,
    ).toBe("optional");
  });

  it.each(["en", "es"] as const)(
    "shows native structure and reconstructed definitions without SQL Server rules in %s",
    (locale) => {
      const value = snapshot();
      const translator = createCatalogTranslator(messageCatalogs[locale], locale);
      const facts = describeObjectDetails(value, entityKey(child), scope);
      if (facts === null) throw new Error("child details");
      const details = presentObjectDetails(facts, translator);
      const text = JSON.stringify(details);
      expect(text).toContain("tenant * 2");
      expect(text).toContain("NULLS NOT DISTINCT");
      expect(text).toContain("MATCH FULL");
      expect(text).toContain("RESTRICT");
      expect(text).toContain("EXCLUDE USING gist");
      expect(text).toContain("FOR EACH STATEMENT");
      expect(text).toContain("UPDATE OF amount");
      expect(text).not.toMatch(
        /SQL Server|NOCHECK|NOT FOR REPLICATION|FIRE_TRIGGERS|TRUNCATE TABLE does not/,
      );
      const nativeView = describeObjectDetails(value, entityKey(materialized), scope);
      if (nativeView === null) throw new Error("view details");
      expect(
        presentObjectDetails(nativeView, translator).sections.some(
          (section) => section.kind === "indexes" && section.items.length === 1,
        ),
      ).toBe(true);
      const viewDefinition = describeViewDefinition(value, entityKey(materialized));
      if (viewDefinition === null) throw new Error("native view definition");
      expect(presentModuleDefinition(viewDefinition, translator).badges.length).toBe(1);
      const module = describeModuleDetails(value, routine, scope);
      if (module === null) throw new Error("routine details");
      const presented = presentModuleDetails(module, translator);
      expect(presented.name).toBe("total(pg_catalog.int4)");
      expect(
        presented.sections.find((section) => section.kind === "parameters")?.items[0],
      ).toMatchObject({ name: "$1", badges: ["IN"] });
      expect(presented.sections.find((section) => section.kind === "returns")).toMatchObject({
        scalarType: "SETOF integer",
        columns: null,
        emptyText: null,
      });
      expect(JSON.stringify(presented)).toContain("plpgsql");
      expect(JSON.stringify(presented)).not.toContain("OUTPUT");
    },
  );

  it("exports native facts through an explicit allowlist, excluding hidden objects and every module body", () => {
    const value = snapshot();
    const native = value.postgresql;
    if (native === undefined) throw new Error("native fixture");
    Object.assign(native, { futureBody: "UNKNOWN_EXTENSION_SENTINEL" });
    const firstIndex = native.indexes[0];
    if (firstIndex === undefined) throw new Error("native index");
    Object.assign(firstIndex, { futureBody: "NESTED_EXTENSION_SENTINEL" });
    const projected = visibleProjection(value, canvas).snapshot;
    expect(projected.provider).toBe("postgreSql");
    expect(projected.postgresql?.routines).toEqual([]);
    expect(projected.postgresql?.triggers[0]?.function).toBeNull();
    expect(projected.postgresql?.triggers[0]?.enabledMode).toBe("replica");
    const text = JSON.stringify(projected);
    expect(text).not.toMatch(
      /HIDDEN_OBJECT_SENTINEL|OFF_DIAGRAM_FUNCTION_SENTINEL|ROUTINE_BODY_SENTINEL|TRIGGER_BODY_SENTINEL|UNKNOWN_EXTENSION_SENTINEL|NESTED_EXTENSION_SENTINEL/,
    );
    expect(text).toContain("tenant * 2");
    expect(text).not.toContain('"dependencies"');
    expect(text).not.toContain('"access"');
  });
});
