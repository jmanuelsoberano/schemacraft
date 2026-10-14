/**
 * Simulated backend for development in a plain browser, where Tauri commands do not exist.
 * It lets the connection flow be designed and reviewed without a database. Loaded only in
 * development builds and only outside the desktop runtime.
 *
 * Server names steer the outcome: `auth-fail`, `cert-fail`, `down` and `slow` reproduce the
 * matching failures; anything else succeeds.
 */
import type {
  ConnectionSettings,
  InspectionStage,
  SchemaSnapshot,
  ServerInformation,
} from "@/shared/contracts";

import type { ConnectionBackend } from "./connectionBackend";
import { OperationError } from "./operationError";

const STAGES: readonly InspectionStage[] = [
  "connecting",
  "readingObjects",
  "readingColumns",
  "readingIndexes",
  "readingForeignKeys",
  "readingConstraints",
  "assembling",
  "completed",
];

let cancelledJobs = new Set<string>();
let nextJobNumber = 1;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function inspectorError(value: string, message: string): OperationError {
  return new OperationError({ type: "inspector", value: value as never }, message);
}

function failureFor(settings: ConnectionSettings): OperationError | null {
  const host = settings.host.toLowerCase();
  if (host.includes("auth-fail")) {
    return inspectorError("authenticationFailed", "Login failed for user 'app'.");
  }
  if (host.includes("cert-fail") && !settings.trustServerCertificate) {
    return inspectorError(
      "untrustedCertificate",
      "The certificate chain was issued by an authority that is not trusted.",
    );
  }
  if (host.includes("down")) {
    return inspectorError("unreachable", "No connection could be made (os error 10061).");
  }
  return null;
}

function column(name: string, declaration: string, isNullable = false) {
  const [base, lengthText] = declaration.split("(");
  const length =
    lengthText === undefined
      ? null
      : lengthText.startsWith("MAX")
        ? { kind: "max" as const }
        : { kind: "fixed" as const, value: Number.parseInt(lengthText, 10) };
  return {
    name,
    ordinalPosition: 0,
    dataType: {
      name: (base ?? "int").toLowerCase(),
      length,
      precision: null,
      scale: null,
      userDefinedTypeName: null,
    },
    isNullable,
    defaultExpression: null,
    isIdentity: name.endsWith("Id") && !isNullable,
    isComputed: false,
  };
}

/** The fixture schema every preview connection returns. */
export function previewSnapshot(database: string): SchemaSnapshot {
  const tables = [
    {
      name: { schema: "dbo", name: "Customers" },
      columns: [
        column("CustomerId", "INT"),
        column("Name", "NVARCHAR(120)"),
        column("Email", "VARCHAR(254)"),
        column("Notes", "NVARCHAR(MAX)", true),
      ],
      primaryKey: { name: "PK_Customers", columns: ["CustomerId"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
    {
      name: { schema: "sales", name: "Orders" },
      columns: [
        column("OrderId", "INT"),
        column("CustomerId", "INT"),
        column("PlacedAt", "DATETIME2"),
        column("Status", "CHAR(1)"),
      ],
      primaryKey: { name: "PK_Orders", columns: ["OrderId"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
    {
      name: { schema: "sales", name: "OrderLines" },
      columns: [
        column("OrderId", "INT"),
        column("LineNumber", "SMALLINT"),
        column("ProductCode", "VARCHAR(32)"),
        column("Quantity", "INT"),
      ],
      primaryKey: { name: "PK_OrderLines", columns: ["OrderId", "LineNumber"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
    {
      name: { schema: "hr", name: "Employees" },
      columns: [
        column("EmployeeId", "INT"),
        column("FullName", "NVARCHAR(200)"),
        column("ManagerId", "INT", true),
      ],
      primaryKey: { name: "PK_Employees", columns: ["EmployeeId"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
  ].map((table) => ({
    ...table,
    columns: table.columns.map((item, index) => ({ ...item, ordinalPosition: index + 1 })),
  }));

  return {
    databaseName: database,
    serverVersion: "Microsoft SQL Server 2022 (preview)",
    extractedAt: new Date().toISOString(),
    tables,
    views: [
      {
        name: { schema: "sales", name: "RecentOrders" },
        columns: [column("OrderId", "INT"), column("CustomerName", "NVARCHAR(120)")],
      },
    ],
    foreignKeys: [
      {
        name: "FK_Orders_Customers",
        referencingTable: { schema: "sales", name: "Orders" },
        referencedTable: { schema: "dbo", name: "Customers" },
        columnPairs: [{ referencingColumn: "CustomerId", referencedColumn: "CustomerId" }],
        onDelete: "noAction",
        onUpdate: "cascade",
        isEnabled: true,
      },
      {
        name: "FK_OrderLines_Orders",
        referencingTable: { schema: "sales", name: "OrderLines" },
        referencedTable: { schema: "sales", name: "Orders" },
        columnPairs: [{ referencingColumn: "OrderId", referencedColumn: "OrderId" }],
        onDelete: "cascade",
        onUpdate: "noAction",
        isEnabled: true,
      },
      {
        name: "FK_Employees_Manager",
        referencingTable: { schema: "hr", name: "Employees" },
        referencedTable: { schema: "hr", name: "Employees" },
        columnPairs: [{ referencingColumn: "ManagerId", referencedColumn: "EmployeeId" }],
        onDelete: "noAction",
        onUpdate: "noAction",
        isEnabled: true,
      },
    ],
  };
}

export const previewConnectionBackend: ConnectionBackend = {
  async testConnection(settings): Promise<ServerInformation> {
    await wait(settings.host.includes("slow") ? 2500 : 600);
    const failure = failureFor(settings);
    if (failure) {
      throw failure;
    }
    return {
      product: "Microsoft SQL Server 2022 (RTM) - 16.0.1000.6 (preview)",
      productVersion: "16.0.1000.6",
      edition: "Developer Edition (64-bit)",
      serverName: settings.host.toUpperCase(),
      databaseName: settings.database ?? "master",
    };
  },

  async listDatabases(): Promise<string[]> {
    await wait(300);
    return ["AdventureWorks2022", "Northwind", "SchemaCraftFixture"];
  },

  async listSchemas(): Promise<string[]> {
    await wait(300);
    return ["dbo", "hr", "sales"];
  },

  async inspectDatabase(settings, options, onEvent): Promise<SchemaSnapshot> {
    const jobId = `preview-${nextJobNumber}`;
    nextJobNumber += 1;
    onEvent({ event: "started", data: { jobId } });

    const failure = failureFor(settings);
    if (failure) {
      await wait(400);
      throw failure;
    }

    for (const stage of STAGES) {
      await wait(settings.host.includes("slow") ? 900 : 350);
      if (cancelledJobs.has(jobId)) {
        cancelledJobs.delete(jobId);
        throw inspectorError("cancelled", "the operation was cancelled");
      }
      const count = stage === "connecting" || stage === "assembling" ? null : 4;
      onEvent({ event: "progress", data: { stage, count } });
    }

    const snapshot = previewSnapshot(settings.database ?? "Northwind");
    return {
      ...snapshot,
      tables: snapshot.tables.filter(
        (table) => options.schemas.length === 0 || options.schemas.includes(table.name.schema),
      ),
      views: options.includeViews ? snapshot.views : [],
    };
  },

  cancelInspection(jobId): Promise<void> {
    cancelledJobs = new Set([...cancelledJobs, jobId]);
    return Promise.resolve();
  },
};
