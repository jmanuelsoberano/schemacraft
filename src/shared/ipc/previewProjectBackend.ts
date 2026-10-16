/**
 * Simulated project files for development in a plain browser, where there are no native
 * dialogs and no disk. Projects live in memory for the lifetime of the page; "open" returns the
 * last saved project or a sample. Loaded only in development builds outside the desktop
 * runtime.
 *
 * The samples cover the ways a project opens: `northwind.scraft` was read with full access,
 * `northwind-reporting.scraft` by a login that sees part of the database, `northwind-1.0.scraft`
 * is a format 1 file upgraded on open, and `northwind-next.scraft` was written by a newer
 * version, so it opens read-only and carries fields this version does not know.
 *
 * A refresh keeps what the fresh capture could not check, as the Rust side does, and the review
 * reports it. When the verdict on access changed, another login read the same database, so the
 * review lists only what appeared or disappeared for it; otherwise it is a fabricated but
 * realistic review with every kind of change.
 */
import type {
  ChangeCounts,
  ChangeKind,
  ColumnChange,
  ForeignKey,
  ForeignKeyChange,
  ForeignKeyToInvisibleTable,
  ForeignKeyToInvisibleTableChange,
  OpenedProject,
  Project,
  ProjectContent,
  QualifiedName,
  SavedConnection,
  SchemaDiff,
  SchemaSnapshot,
  Table,
  TableChange,
  ViewChange,
} from "@/shared/contracts";

import { OperationError } from "./operationError";
import {
  accessChanged,
  compareKeys,
  compareNames,
  factsNowAvailable,
  keyIdentity,
  keysWhoseTargetBecameVisible,
  nameKey,
  withUncheckedFacts,
} from "./previewAccess";
import { previewSnapshot } from "./previewConnectionBackend";
import type { ProjectBackend } from "./projectBackend";

/** Format the preview writes, as `FORMAT_VERSION` and `MIN_READER_VERSION` on the Rust side. */
const FORMAT_VERSION = 2;
const MIN_READER_VERSION = 2;
const GENERATOR = "SchemaCraft 1.0.0 (preview)";

const SAMPLE_PATH = "C:\\Projects\\northwind.scraft";

const files = new Map<string, Project>();

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

const LOCAL_CONNECTION: SavedConnection = {
  provider: "sqlServer",
  host: "localhost",
  instance: "SQLEXPRESS",
  port: null,
  database: "Northwind",
  authentication: { mode: "integrated" },
  encryption: "mandatory",
  trustServerCertificate: true,
};

function sampleProject(snapshot: SchemaSnapshot, connection = LOCAL_CONNECTION): Project {
  return {
    formatVersion: FORMAT_VERSION,
    minReaderVersion: MIN_READER_VERSION,
    savedAt: hoursAgo(1),
    savedWith: GENERATOR,
    connection,
    inspection: { schemas: [], includeViews: true },
    snapshot: { ...snapshot, extractedAt: hoursAgo(2) },
    canvas: { detailLevel: "keys", layout: "manual", viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
  };
}

/**
 * What reading a SchemaCraft 1.0 file gives, for a capture whose login could not read the
 * texts of the sales schema: 1.0 saved those `CHECK` texts empty and those defaults as absent,
 * so the upgrade marks both not recorded. No access profile and no `CHECK` state were saved.
 */
function upgradedFormatOneSnapshot(): SchemaSnapshot {
  const snapshot = previewSnapshot("Northwind");
  delete snapshot.access;
  const upgraded = (table: Table): Table =>
    table.name.schema === "sales"
      ? {
          ...table,
          columns: table.columns.map((column) => ({
            ...column,
            defaultExpression: { status: "notRecorded" },
          })),
          checkConstraints: table.checkConstraints.map((constraint) => ({
            ...constraint,
            expression: { status: "notRecorded" },
            isEnabled: null,
          })),
        }
      : {
          ...table,
          checkConstraints: table.checkConstraints.map((constraint) => ({
            ...constraint,
            isEnabled: null,
          })),
        };
  return { ...snapshot, tables: snapshot.tables.map(upgraded) };
}

/**
 * A file written by a newer version that still lets this one read it: format 3 with
 * `minReaderVersion` 2. It carries fields this version does not know at the root, in the
 * snapshot, in the canvas and in every node, which must survive untouched.
 */
function newerFormatProject(): Project {
  const snapshot = previewSnapshot("Northwind");
  const names = [...snapshot.tables, ...snapshot.views]
    .map((entity) => entity.name)
    .toSorted(compareNames);
  const nodeExtras = { color: "teal" };
  const project = sampleProject({
    ...snapshot,
    ...{ routines: [{ name: { schema: "sales", name: "usp_PlaceOrder" }, kind: "procedure" }] },
  });
  return {
    ...project,
    formatVersion: 3,
    savedWith: "SchemaCraft 1.3.0",
    canvas: {
      ...project.canvas,
      ...{ gridSize: 16 },
      nodes: names.map((name, index) => ({
        name,
        position: { x: (index % 3) * 340, y: Math.floor(index / 3) * 280 },
        isCollapsed: false,
        isHidden: false,
        ...nodeExtras,
      })),
    },
    ...{
      annotations: [{ entity: { schema: "sales", name: "Orders" }, text: "Monthly partitions" }],
    },
  };
}

const SAMPLES = new Map<string, () => OpenedProject>([
  [
    SAMPLE_PATH,
    () => ({ project: sampleProject(previewSnapshot("Northwind")), isReadOnly: false }),
  ],
  [
    "C:\\Projects\\northwind-reporting.scraft",
    () => ({
      project: sampleProject(previewSnapshot("Northwind", "partial"), {
        ...LOCAL_CONNECTION,
        host: "partial.example.com",
        instance: null,
        port: 1433,
        authentication: { mode: "sqlLogin", username: "reporting" },
        trustServerCertificate: false,
      }),
      isReadOnly: false,
    }),
  ],
  [
    "C:\\Projects\\northwind-1.0.scraft",
    () => ({
      project: { ...sampleProject(upgradedFormatOneSnapshot()), savedWith: "SchemaCraft 1.0.0" },
      isReadOnly: false,
    }),
  ],
  [
    "C:\\Projects\\northwind-next.scraft",
    () => ({ project: newerFormatProject(), isReadOnly: true }),
  ],
]);

function column(name: string, typeName: string, isNullable = false) {
  return {
    name,
    ordinalPosition: 0,
    dataType: {
      name: typeName,
      length: null,
      precision: null,
      scale: null,
      userDefinedTypeName: null,
    },
    isNullable,
    defaultExpression: null,
    isIdentity: false,
    isComputed: false,
  };
}

/** The schema changes of a diff, without what the fresh capture could or could not check. */
type SchemaChanges = Omit<SchemaDiff, "notChecked" | "nowAvailable" | "accessChanged">;

function countsOf(changes: readonly { kind: ChangeKind }[]): ChangeCounts {
  const count = (kind: ChangeKind) => changes.filter((change) => change.kind === kind).length;
  return { added: count("added"), removed: count("removed"), changed: count("changed") };
}

function withSummary(changes: Omit<SchemaChanges, "summary">): SchemaChanges {
  return {
    ...changes,
    summary: {
      tables: countsOf(changes.tables),
      views: countsOf(changes.views),
      foreignKeys: countsOf([...changes.foreignKeys, ...changes.foreignKeysToInvisibleTables]),
    },
  };
}

/** A review with every kind of change, so the dialog can be designed against real shapes. */
function fabricatedChanges(current: SchemaSnapshot): SchemaChanges {
  const orders = current.tables.find((table) => table.name.name === "Orders");
  const columnChanges: ColumnChange[] = [
    { kind: "added", column: column("Currency", "char") },
    {
      kind: "changed",
      before: {
        ...column("Status", "char"),
        defaultExpression: { status: "readable", text: "('N')" },
      },
      after: {
        ...column("Status", "varchar", true),
        defaultExpression: { status: "readable", text: "('new')" },
      },
      properties: ["dataType", "nullability", "defaultExpression"],
    },
    { kind: "removed", column: column("LegacyCode", "varchar", true) },
  ];
  const tables: TableChange[] = [
    { kind: "added", name: { schema: "sales", name: "Invoices" }, columnCount: 6 },
    {
      kind: "changed",
      name: orders?.name ?? { schema: "sales", name: "Orders" },
      columns: columnChanges,
      primaryKey: null,
      indexes: [
        {
          kind: "added",
          index: {
            name: "IX_Orders_PlacedAt",
            columns: ["PlacedAt"],
            kind: "nonUnique",
            isClustered: false,
          },
        },
      ],
      checkConstraints: [
        {
          kind: "changed",
          before: {
            name: "CK_Orders_Status",
            expression: {
              status: "readable",
              text: "([Status]='C' OR [Status]='S' OR [Status]='P' OR [Status]='N')",
            },
            isEnabled: true,
          },
          after: {
            name: "CK_Orders_Status",
            expression: {
              status: "readable",
              text: "([Status]='cancelled' OR [Status]='shipped' OR [Status]='placed' OR [Status]='new')",
            },
            isEnabled: true,
          },
        },
        {
          kind: "changed",
          before: {
            name: "CK_Orders_ShippedAt",
            expression: { status: "readable", text: "([ShippedAt]>=[PlacedAt])" },
            isEnabled: true,
          },
          after: {
            name: "CK_Orders_ShippedAt",
            expression: { status: "readable", text: "([ShippedAt]>=[PlacedAt])" },
            isEnabled: false,
          },
        },
      ],
    },
    { kind: "removed", name: { schema: "dbo", name: "AuditLog" }, columnCount: 9 },
  ];
  const foreignKeys: ForeignKeyChange[] = [
    {
      kind: "added",
      key: {
        name: "FK_Invoices_Orders",
        referencingTable: { schema: "sales", name: "Invoices" },
        referencedTable: { schema: "sales", name: "Orders" },
        columnPairs: [{ referencingColumn: "OrderId", referencedColumn: "OrderId" }],
        onDelete: "noAction",
        onUpdate: "noAction",
        isEnabled: true,
      },
    },
  ];
  // Only a key the capture draws can change as an edge.
  const ordersCustomers = current.foreignKeys.find((key) => key.name === "FK_Orders_Customers");
  if (ordersCustomers !== undefined) {
    foreignKeys.push({
      kind: "changed",
      before: ordersCustomers,
      after: { ...ordersCustomers, onDelete: "cascade", isEnabled: false },
      properties: ["onDelete", "enabled"],
    });
  }
  // A capture that cannot see every referenced table also reports keys to invisible tables.
  const foreignKeysToInvisibleTables: ForeignKeyToInvisibleTableChange[] =
    current.foreignKeysToInvisibleTables === undefined
      ? []
      : [
          {
            kind: "added",
            key: {
              name: "FK_OrderLines_Products",
              referencingTable: { schema: "sales", name: "OrderLines" },
              columns: ["ProductCode"],
              onDelete: "noAction",
              onUpdate: "noAction",
              isEnabled: true,
            },
          },
        ];
  return withSummary({
    tables,
    views: [{ kind: "removed", name: { schema: "sales", name: "RecentOrders" }, columnCount: 2 }],
    foreignKeys,
    foreignKeysToInvisibleTables,
  });
}

/**
 * The changes between two captures of the same database by logins that see different parts of
 * it: objects and keys that appeared or disappeared, never a changed definition. A key whose
 * referenced table became visible is neither added nor removed; the review lists it as now
 * available.
 */
function visibilityChanges(previous: SchemaSnapshot, merged: SchemaSnapshot): SchemaChanges {
  const appearances = (
    before: readonly { name: QualifiedName; columns: readonly unknown[] }[],
    after: readonly { name: QualifiedName; columns: readonly unknown[] }[],
  ) => {
    const had = new Set(before.map((entity) => nameKey(entity.name)));
    const has = new Set(after.map((entity) => nameKey(entity.name)));
    return [
      ...after
        .filter((entity) => !had.has(nameKey(entity.name)))
        .map((entity) => ({
          kind: "added" as const,
          name: entity.name,
          columnCount: entity.columns.length,
        })),
      ...before
        .filter((entity) => !has.has(nameKey(entity.name)))
        .map((entity) => ({
          kind: "removed" as const,
          name: entity.name,
          columnCount: entity.columns.length,
        })),
    ].toSorted((left, right) => compareNames(left.name, right.name));
  };

  const visibleTargets = keysWhoseTargetBecameVisible(previous, merged);
  const keyAppearances = <Key extends ForeignKey | ForeignKeyToInvisibleTable>(
    before: readonly Key[],
    after: readonly Key[],
  ) => {
    const had = new Set(before.map(keyIdentity));
    const has = new Set(after.map(keyIdentity));
    const isChange = (key: Key) => !visibleTargets.has(keyIdentity(key));
    return [
      ...after
        .filter((key) => !had.has(keyIdentity(key)) && isChange(key))
        .map((key) => ({ kind: "added" as const, key })),
      ...before
        .filter((key) => !has.has(keyIdentity(key)) && isChange(key))
        .map((key) => ({ kind: "removed" as const, key })),
    ].toSorted((left, right) => compareKeys(left.key, right.key));
  };

  const tables: TableChange[] = appearances(previous.tables, merged.tables);
  const views: ViewChange[] = appearances(previous.views, merged.views);
  return withSummary({
    tables,
    views,
    foreignKeys: keyAppearances(previous.foreignKeys, merged.foreignKeys),
    foreignKeysToInvisibleTables: keyAppearances(
      previous.foreignKeysToInvisibleTables ?? [],
      merged.foreignKeysToInvisibleTables ?? [],
    ),
  });
}

export const previewProjectBackend: ProjectBackend = {
  async pickProjectToOpen(): Promise<string | null> {
    await wait(300);
    return [...files.keys()].at(-1) ?? SAMPLE_PATH;
  },

  async pickProjectToSave(_title, suggestedFileName): Promise<string | null> {
    await wait(300);
    return suggestedFileName.includes("\\")
      ? suggestedFileName
      : `C:\\Projects\\${suggestedFileName}`;
  },

  async readProject(path): Promise<OpenedProject> {
    await wait(400);
    const file = files.get(path);
    if (file !== undefined) {
      return { project: structuredClone(file), isReadOnly: false };
    }
    const sample = SAMPLES.get(path);
    if (sample === undefined) {
      throw new OperationError(
        { type: "project", value: "notFound" },
        `the project file ${path} does not exist`,
      );
    }
    return sample();
  },

  async writeProject(path, content): Promise<Project> {
    await wait(400);
    // The header comes last so that header keys kept among the unknown fields never win.
    const file: Project = {
      ...structuredClone(content),
      formatVersion: FORMAT_VERSION,
      minReaderVersion: MIN_READER_VERSION,
      savedAt: new Date().toISOString(),
      savedWith: GENERATOR,
    };
    files.set(path, file);
    return structuredClone(file);
  },

  async computeSchemaDiff(previous, current): Promise<SchemaDiff> {
    await wait(300);
    const merged = withUncheckedFacts(current, previous);
    const changedAccess = accessChanged(previous, merged);
    return {
      ...(changedAccess ? visibilityChanges(previous, merged) : fabricatedChanges(merged)),
      notChecked: merged.carriedOver ?? [],
      nowAvailable: factsNowAvailable(previous, merged),
      accessChanged: changedAccess,
    };
  },

  refreshProjectContent(content, snapshot): Promise<ProjectContent> {
    const merged = withUncheckedFacts(snapshot, content.snapshot);
    const entities = [...merged.tables, ...merged.views];
    return Promise.resolve({
      ...content,
      snapshot: merged,
      canvas: {
        ...content.canvas,
        nodes: content.canvas.nodes.filter((node) =>
          entities.some(
            (entity) =>
              entity.name.schema === node.name.schema && entity.name.name === node.name.name,
          ),
        ),
      },
    });
  },
};
