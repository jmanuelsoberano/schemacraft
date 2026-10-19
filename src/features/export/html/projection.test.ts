import { describe, expect, it } from "vitest";

import type {
  CanvasState,
  CaptureState,
  CheckConstraint,
  Column,
  Definition,
  ForeignKey,
  ForeignKeyToInvisibleTable,
  Index,
  ModuleBody,
  PrimaryKey,
  Programmability,
  SchemaSnapshot,
  Table,
  Trigger,
  TypeLength,
  View,
  ViewModule,
} from "@/shared/contracts";

import { visibleProjection } from "./viewerData";

/**
 * Every field required, all the way down, and every variant of a union present (`EveryVariant`):
 * a field Rust adds to an exported type or to any variant, or a new variant, makes the fixtures
 * below fail to compile until someone fills it in, and then the inventory below fails until
 * someone decides whether it may leave the application.
 */
type DeepRequired<T> = T extends (infer Item)[]
  ? DeepRequired<Item>[]
  : T extends object
    ? { [Key in keyof T]-?: DeepRequired<NonNullable<T[Key]>> }
    : T;

/**
 * One fixture per variant of a union, keyed by its tag: a new variant fails to compile, and a
 * field added to any variant is required by `DeepRequired`. A fixture that names one variant of a
 * union would let the others change unseen.
 */
type EveryVariant<Union, Tag extends keyof Union> = {
  [Value in Union[Tag] & string]: DeepRequired<Extract<Union, Record<Tag, Value>>>;
};

const definitions: EveryVariant<Definition, "status"> = {
  readable: { status: "readable", text: "((0))" },
  notVisible: { status: "notVisible" },
  encrypted: { status: "encrypted" },
  notRecorded: { status: "notRecorded" },
  unknown: { status: "unknown" },
};

const typeLengths: EveryVariant<TypeLength, "kind"> = {
  fixed: { kind: "fixed", value: 4 },
  max: { kind: "max" },
};

const integer = {
  name: "int",
  length: typeLengths.fixed,
  precision: 10,
  scale: 0,
  userDefinedTypeName: "dbo.Identifier",
};

const column: DeepRequired<Column> = {
  name: "OrderId",
  ordinalPosition: 1,
  dataType: integer,
  isNullable: false,
  defaultExpression: definitions.readable,
  isIdentity: true,
  isComputed: false,
};

/** The column once per variant of each union it holds, so every variant reaches the projection. */
const columns: DeepRequired<Column>[] = [
  ...Object.values(definitions).map((defaultExpression, offset) => ({
    ...column,
    name: `Column${offset}`,
    ordinalPosition: offset + 1,
    defaultExpression,
  })),
  ...Object.values(typeLengths).map((length, offset) => ({
    ...column,
    name: `Sized${offset}`,
    dataType: { ...integer, length },
  })),
];

const primaryKey: DeepRequired<PrimaryKey> = {
  name: "PK_Orders",
  columns: ["OrderId"],
  isClustered: true,
  isEnabled: true,
};

const index: DeepRequired<Index> = {
  name: "IX_Orders_PlacedAt",
  columns: ["PlacedAt"],
  kind: "uniqueIndex",
  isClustered: false,
  includedColumns: ["Total"],
  isFiltered: true,
  isEnabled: false,
};

const checkConstraint: DeepRequired<CheckConstraint> = {
  name: "CK_Orders_Total",
  expression: { status: "readable", text: "([Total]>=(0))" },
  isEnabled: true,
  isTrusted: false,
};

const checkConstraints: DeepRequired<CheckConstraint>[] = Object.values(definitions).map(
  (expression, offset) => ({ ...checkConstraint, name: `CK_Orders_${offset}`, expression }),
);

const table: DeepRequired<Table> = {
  name: { schema: "sales", name: "Orders" },
  columns,
  primaryKey,
  indexes: [index],
  checkConstraints,
};

const view: DeepRequired<View> = {
  name: { schema: "sales", name: "RecentOrders" },
  columns,
};

const foreignKey: DeepRequired<ForeignKey> = {
  name: "FK_Orders_Orders",
  referencingTable: table.name,
  referencedTable: table.name,
  columnPairs: [{ referencingColumn: "OrderId", referencedColumn: "OrderId" }],
  onDelete: "noAction",
  onUpdate: "cascade",
  isEnabled: true,
  isTrusted: false,
};

const keyToInvisibleTable: DeepRequired<ForeignKeyToInvisibleTable> = {
  name: "FK_Orders_Regions",
  referencingTable: table.name,
  columns: ["RegionId"],
  onDelete: "setNull",
  onUpdate: "noAction",
  isEnabled: false,
  isTrusted: true,
};

const snapshot: SchemaSnapshot = {
  databaseName: "Shop",
  serverVersion: null,
  extractedAt: "2026-10-18T18:00:00Z",
  tables: [table],
  views: [view],
  foreignKeys: [foreignKey],
  foreignKeysToInvisibleTables: [keyToInvisibleTable],
};

const canvas: CanvasState = {
  detailLevel: "full",
  layout: "manual",
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [table.name, view.name].map((name) => ({
    name,
    position: { x: 0, y: 0 },
    isCollapsed: false,
    isHidden: false,
  })),
};

const captures: EveryVariant<CaptureState, "status"> = {
  read: { status: "read" },
  notRead: { status: "notRead", reason: "queryFailed" },
  unknown: { status: "unknown" },
};

const bodies: EveryVariant<ModuleBody, "language"> = {
  sql: { language: "sql", definition: definitions.readable },
  clr: { language: "clr" },
  unknown: { language: "unknown" },
};

const trigger: DeepRequired<Trigger> = {
  parent: table.name,
  name: "TR_Orders_Log",
  timing: "after",
  events: [{ event: "insert", order: "first" }],
  isEnabled: true,
  isNotForReplication: true,
  body: bodies.sql,
};

const viewModule: DeepRequired<ViewModule> = {
  view: view.name,
  definition: definitions.readable,
  hasCheckOption: true,
  isIndexed: true,
};

const programmability: DeepRequired<Programmability> = {
  capture: { objects: captures.read, definitions: captures.read },
  views: Object.values(definitions).map((definition) => ({ ...viewModule, definition })),
  triggers: [
    ...Object.values(bodies),
    ...Object.values(definitions).map((definition) => ({ language: "sql", definition }) as const),
  ].map((body, index) => ({ ...trigger, name: `${trigger.name}${index}`, body })),
  routines: [],
  carriedOver: [],
};

const snapshotWithCode: SchemaSnapshot = { ...snapshot, programmability };

/** Every key path under `value`, with `[]` for the items of a list. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => keyPaths(item, `${prefix}[]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) => {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      return [path, ...keyPaths(inner, path)];
    });
  }
  return [];
}

function inventory(value: unknown): string[] {
  return [...new Set(keyPaths(value))].sort();
}

const COLUMN_KEYS = [
  "dataType",
  "dataType.length",
  "dataType.length.kind",
  "dataType.length.value",
  "dataType.name",
  "dataType.precision",
  "dataType.scale",
  "dataType.userDefinedTypeName",
  "defaultExpression",
  "defaultExpression.status",
  "defaultExpression.text",
  "isComputed",
  "isIdentity",
  "isNullable",
  "name",
  "ordinalPosition",
];

const NAME_KEYS = ["name", "name.name", "name.schema"];

/**
 * Every field an HTML export carries of a table, a view and a key: tables, views and keys on the
 * diagram travel whole. When this list fails, a field was added or dropped: decide whether the
 * new field may leave the application (code, for one, may not), drop it in `visibleProjection`
 * if not, and update the list in the same change, where a review sees it.
 */
const EXPORTED_TABLE_KEYS = [
  "checkConstraints",
  "checkConstraints[].expression",
  "checkConstraints[].expression.status",
  "checkConstraints[].expression.text",
  "checkConstraints[].isEnabled",
  "checkConstraints[].isTrusted",
  "checkConstraints[].name",
  "columns",
  ...COLUMN_KEYS.map((key) => `columns[].${key}`),
  "indexes",
  "indexes[].columns",
  "indexes[].includedColumns",
  "indexes[].isClustered",
  "indexes[].isEnabled",
  "indexes[].isFiltered",
  "indexes[].kind",
  "indexes[].name",
  ...NAME_KEYS,
  "primaryKey",
  "primaryKey.columns",
  "primaryKey.isClustered",
  "primaryKey.isEnabled",
  "primaryKey.name",
].sort();

const EXPORTED_VIEW_KEYS = [
  "columns",
  ...COLUMN_KEYS.map((key) => `columns[].${key}`),
  ...NAME_KEYS,
].sort();

const EXPORTED_FOREIGN_KEY_KEYS = [
  "columnPairs",
  "columnPairs[].referencedColumn",
  "columnPairs[].referencingColumn",
  "isEnabled",
  "isTrusted",
  "name",
  "onDelete",
  "onUpdate",
  "referencedTable",
  "referencedTable.name",
  "referencedTable.schema",
  "referencingTable",
  "referencingTable.name",
  "referencingTable.schema",
].sort();

const EXPORTED_KEY_TO_INVISIBLE_TABLE_KEYS = [
  "columns",
  "isEnabled",
  "isTrusted",
  "name",
  "onDelete",
  "onUpdate",
  "referencingTable",
  "referencingTable.name",
  "referencingTable.schema",
].sort();

describe("the fields an HTML export carries", () => {
  const projected = visibleProjection(snapshot, canvas).snapshot;

  it("are pinned for tables, with their columns, keys, indexes and constraints", () => {
    expect(inventory(projected.tables)).toEqual(EXPORTED_TABLE_KEYS.map((key) => `[].${key}`));
  });

  it("are pinned for views", () => {
    expect(inventory(projected.views)).toEqual(EXPORTED_VIEW_KEYS.map((key) => `[].${key}`));
  });

  it("are pinned for foreign keys, to visible tables and to tables not visible", () => {
    expect(inventory(projected.foreignKeys)).toEqual(
      EXPORTED_FOREIGN_KEY_KEYS.map((key) => `[].${key}`),
    );
    expect(inventory(projected.foreignKeysToInvisibleTables)).toEqual(
      EXPORTED_KEY_TO_INVISIBLE_TABLE_KEYS.map((key) => `[].${key}`),
    );
  });

  it("are the snapshot root this version knows, without code", () => {
    expect(Object.keys(projected).sort()).toEqual([
      "databaseName",
      "extractedAt",
      "foreignKeys",
      "foreignKeysToInvisibleTables",
      "serverVersion",
      "tables",
      "views",
    ]);
  });
});

describe("the module metadata an HTML export carries", () => {
  it("pins the explicit metadata subset, excluding texts, routines and the code ledger", () => {
    const projected = visibleProjection(snapshotWithCode, canvas).snapshot.programmability;
    expect(inventory(projected)).toEqual(
      [
        "capture",
        "capture.objects",
        "capture.objects.status",
        "capture.definitions",
        "capture.definitions.status",
        "routines",
        "triggers",
        "triggers[].parent",
        "triggers[].parent.schema",
        "triggers[].parent.name",
        "triggers[].name",
        "triggers[].timing",
        "triggers[].events",
        "triggers[].events[].event",
        "triggers[].events[].order",
        "triggers[].isEnabled",
        "triggers[].isNotForReplication",
        "triggers[].body",
        "triggers[].body.language",
        "triggers[].body.definition",
        "triggers[].body.definition.status",
        "views",
        "views[].view",
        "views[].view.schema",
        "views[].view.name",
        "views[].definition",
        "views[].definition.status",
        "views[].hasCheckOption",
        "views[].isIndexed",
      ].sort(),
    );
    expect(projected?.routines).toEqual([]);
    expect(projected).not.toHaveProperty("carriedOver");
    expect(projected?.views.map((module) => module.definition.status)).toEqual([
      "unknown",
      "notVisible",
      "encrypted",
      "notRecorded",
      "unknown",
    ]);
    expect(JSON.stringify(projected)).not.toContain('"text"');
  });

  it.each([
    { status: "notRead", reason: "optionOff" },
    { status: "notRead", reason: "queryFailed" },
    { status: "notRead", reason: "timedOut" },
    captures.unknown,
  ] as const)("exports no stale metadata when the object capture is %j", (objects) => {
    const projected = visibleProjection(
      {
        ...snapshotWithCode,
        programmability: { ...programmability, capture: { objects, definitions: captures.read } },
      },
      canvas,
    ).snapshot.programmability;
    expect(projected?.capture.objects).toEqual(objects);
    expect(projected?.triggers).toEqual([]);
    expect(projected?.views).toEqual([]);
  });

  it("keeps definition capture states without carrying their extensions", () => {
    for (const definitions of Object.values(captures)) {
      const projected = visibleProjection(
        {
          ...snapshotWithCode,
          programmability: {
            ...programmability,
            capture: {
              objects: captures.read,
              definitions: { ...definitions, ...{ text: "PRIVATE_SOURCE" } },
            },
          },
        },
        canvas,
      ).snapshot.programmability;
      expect(projected?.capture.definitions).toEqual(definitions);
      expect(projected?.triggers.length).toBe(programmability.triggers.length);
    }
  });

  it("excludes metadata of whole kept parents but keeps their dates outside the snapshot", () => {
    const carriedOver = [
      { object: table.name, fact: { kind: "table" }, readAt: "2026-10-17T12:00:00Z" },
      { object: view.name, fact: { kind: "view" }, readAt: "2026-10-17T12:00:00Z" },
    ] as const;
    const projected = visibleProjection(
      {
        ...snapshotWithCode,
        carriedOver: [...carriedOver],
        programmability: {
          ...programmability,
          carriedOver: [
            {
              object: { kind: "trigger", parent: table.name, name: trigger.name },
              part: "whole",
              readAt: "2026-10-17T12:00:00Z",
            },
            {
              object: { kind: "view", name: view.name },
              part: "whole",
              readAt: "2026-10-17T12:00:00Z",
            },
          ],
        },
      },
      canvas,
    );
    expect(projected.snapshot.programmability?.capture.objects).toEqual(captures.read);
    expect(projected.snapshot.programmability?.triggers).toEqual([]);
    expect(projected.snapshot.programmability?.views).toEqual([]);
    expect(projected.carriedOver).toEqual(carriedOver);
  });

  it.each(["trigger", "view"] as const)(
    "never claims a complete list for an undated whole kept %s",
    (kind) => {
      const object =
        kind === "trigger"
          ? ({ kind, parent: table.name, name: trigger.name } as const)
          : ({ kind, name: view.name } as const);
      const projected = visibleProjection(
        {
          ...snapshotWithCode,
          programmability: {
            ...programmability,
            carriedOver: [{ object, part: "whole", readAt: "2026-10-17T12:00:00Z" }],
          },
        },
        canvas,
      ).snapshot.programmability;
      expect(projected?.capture.objects).toEqual({ status: "unknown" });
      expect(projected?.triggers).toEqual([]);
      expect(projected?.views).toEqual([]);
    },
  );

  it("keeps current metadata when only its definition was kept", () => {
    const projected = visibleProjection(
      {
        ...snapshotWithCode,
        programmability: {
          ...programmability,
          carriedOver: [
            {
              object: { kind: "trigger", parent: table.name, name: trigger.name },
              part: "definition",
              readAt: "2026-10-17T12:00:00Z",
            },
          ],
        },
      },
      canvas,
    ).snapshot.programmability;
    expect(projected?.capture.objects).toEqual(captures.read);
    expect(projected?.triggers.length).toBe(programmability.triggers.length);
    expect(projected).not.toHaveProperty("carriedOver");
    expect(JSON.stringify(projected)).not.toContain('"text"');
  });

  it("preserves an explicit failed-read reason even when an old whole module has no parent date", () => {
    const projected = visibleProjection(
      {
        ...snapshotWithCode,
        programmability: {
          ...programmability,
          capture: { objects: captures.notRead, definitions: captures.notRead },
          carriedOver: [
            {
              object: { kind: "trigger", parent: table.name, name: trigger.name },
              part: "whole",
              readAt: "2026-10-17T12:00:00Z",
            },
          ],
        },
      },
      canvas,
    ).snapshot.programmability;
    expect(projected?.capture.objects).toEqual(captures.notRead);
    expect(projected?.triggers).toEqual([]);
  });

  it("does not export a view module attached to a table instead of a visible view", () => {
    const projected = visibleProjection(
      {
        ...snapshotWithCode,
        programmability: { ...programmability, views: [{ ...viewModule, view: table.name }] },
      },
      canvas,
    ).snapshot.programmability;
    expect(projected?.views).toEqual([]);
  });
});
