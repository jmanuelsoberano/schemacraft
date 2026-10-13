/**
 * Simulated project files for development in a plain browser, where there are no native
 * dialogs and no disk. Projects live in memory for the lifetime of the page; "open" returns the
 * last saved project or a sample; the diff is a fabricated but realistic review. Loaded only in
 * development builds outside the desktop runtime.
 */
import type {
  ColumnChange,
  ForeignKeyChange,
  Project,
  ProjectContent,
  SchemaDiff,
  SchemaSnapshot,
  TableChange,
} from "@/shared/contracts";

import { OperationError } from "./operationError";
import { previewSnapshot } from "./previewConnectionBackend";
import type { ProjectBackend } from "./projectBackend";

const SAMPLE_PATH = "C:\\Projects\\northwind.scraft";

const files = new Map<string, Project>();

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function sampleProject(): Project {
  return {
    formatVersion: 1,
    savedAt: new Date(Date.now() - 3_600_000).toISOString(),
    savedWith: "SchemaCraft 0.1.0 (preview)",
    connection: {
      provider: "sqlServer",
      host: "localhost",
      instance: "SQLEXPRESS",
      port: null,
      database: "Northwind",
      authentication: { mode: "integrated" },
      encryption: "mandatory",
      trustServerCertificate: true,
    },
    inspection: { schemas: [], includeViews: true },
    snapshot: previewSnapshot("Northwind"),
    canvas: { detailLevel: "keys", layout: "manual", viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
  };
}

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

/** A review with every kind of change, so the dialog can be designed against real shapes. */
function fabricatedDiff(current: SchemaSnapshot): SchemaDiff {
  const orders = current.tables.find((table) => table.name.name === "Orders");
  const columnChanges: ColumnChange[] = [
    { kind: "added", column: column("Currency", "char") },
    {
      kind: "changed",
      before: column("Status", "char"),
      after: { ...column("Status", "varchar", true), defaultExpression: "('new')" },
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
      checkConstraints: [],
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
    {
      kind: "changed",
      before: {
        name: "FK_Orders_Customers",
        referencingTable: { schema: "sales", name: "Orders" },
        referencedTable: { schema: "dbo", name: "Customers" },
        columnPairs: [{ referencingColumn: "CustomerId", referencedColumn: "CustomerId" }],
        onDelete: "noAction",
        onUpdate: "cascade",
        isEnabled: true,
      },
      after: {
        name: "FK_Orders_Customers",
        referencingTable: { schema: "sales", name: "Orders" },
        referencedTable: { schema: "dbo", name: "Customers" },
        columnPairs: [{ referencingColumn: "CustomerId", referencedColumn: "CustomerId" }],
        onDelete: "cascade",
        onUpdate: "cascade",
        isEnabled: false,
      },
      properties: ["onDelete", "enabled"],
    },
  ];
  return {
    tables,
    views: [{ kind: "removed", name: { schema: "sales", name: "RecentOrders" }, columnCount: 2 }],
    foreignKeys,
    summary: {
      tables: { added: 1, removed: 1, changed: 1 },
      views: { added: 0, removed: 1, changed: 0 },
      foreignKeys: { added: 1, removed: 0, changed: 1 },
    },
  };
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

  async readProject(path): Promise<Project> {
    await wait(400);
    if (path === SAMPLE_PATH) {
      return sampleProject();
    }
    const file = files.get(path);
    if (file === undefined) {
      throw new OperationError(
        { type: "project", value: "notFound" },
        `the project file ${path} does not exist`,
      );
    }
    return structuredClone(file);
  },

  async writeProject(path, content): Promise<Project> {
    await wait(400);
    const file: Project = {
      formatVersion: 1,
      savedAt: new Date().toISOString(),
      savedWith: "SchemaCraft 0.1.0 (preview)",
      ...structuredClone(content),
    };
    files.set(path, file);
    return structuredClone(file);
  },

  async computeSchemaDiff(_previous, current): Promise<SchemaDiff> {
    await wait(300);
    return fabricatedDiff(current);
  },

  refreshProjectContent(content, snapshot): Promise<ProjectContent> {
    const exists = new Set(
      [...snapshot.tables, ...snapshot.views].map(
        (entity) => `${entity.name.schema}.${entity.name.name}`,
      ),
    );
    return Promise.resolve({
      ...content,
      snapshot,
      canvas: {
        ...content.canvas,
        nodes: content.canvas.nodes.filter((node) =>
          exists.has(`${node.name.schema}.${node.name.name}`),
        ),
      },
    });
  },
};
