/**
 * Simulated backend for development in a plain browser, where Tauri commands do not exist.
 * It lets the connection flow be designed and reviewed without a database. Loaded only in
 * development builds and only outside the desktop runtime.
 *
 * Server names steer the outcome: `auth-fail`, `cert-fail`, `down` and `slow` reproduce the
 * matching failures. `partial`, `nothing` and `empty` choose what the login sees: part of the
 * database, none of it, or an empty database it owns. Anything else sees everything.
 */
import type {
  AccessProbe,
  CheckConstraint,
  Column,
  ConnectionSettings,
  DatabaseDescription,
  ForeignKey,
  ForeignKeyToInvisibleTable,
  Index,
  InspectionOptions,
  InspectionStage,
  SchemaAccess,
  SchemaSnapshot,
  ServerInformation,
  SqlDataType,
  Table,
  View,
} from "@/shared/contracts";

import type { ConnectionBackend } from "./connectionBackend";
import { OperationError } from "./operationError";
import { nameKey, observedAccess, predictedAccess } from "./previewAccess";

const EVERYTHING: InspectionOptions = {
  schemas: [],
  includeViews: true,
  includeProgrammability: true,
  includeModuleDefinitions: true,
};

const STAGES: readonly InspectionStage[] = [
  "connecting",
  "checkingAccess",
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

/**
 * What the preview login sees: `full` (the owner), `partial` (`SELECT` on hr and sales,
 * `VIEW DEFINITION` on hr only, nothing of dbo), `nothing` (`CONNECT` only) or `empty` (the
 * owner of a database without tables or views).
 */
export type PreviewAccess = "full" | "partial" | "nothing" | "empty";

function previewAccessFor(settings: ConnectionSettings): PreviewAccess {
  const host = settings.host.toLowerCase();
  if (host.includes("nothing")) {
    return "nothing";
  }
  if (host.includes("empty")) {
    return "empty";
  }
  return host.includes("partial") ? "partial" : "full";
}

interface Grant {
  /** `VIEW DEFINITION`: the login reads the `CHECK` and `DEFAULT` texts. */
  definitions: boolean;
  /** `SELECT`: the login sees the tables and views. */
  data: boolean;
}

interface PreviewLogin {
  /** Rights on the whole database. */
  database: Grant;
  /** Rights on single schemas, on top of the database ones. */
  schemas: Readonly<Partial<Record<string, Grant>>>;
  databaseUser: string;
  /** Whether the database holds the fixture schema; the `empty` one holds nothing. */
  holdsFixture: boolean;
}

const NO_GRANT: Grant = { definitions: false, data: false };
const OWNER_GRANT: Grant = { definitions: true, data: true };

const LOGINS: Record<PreviewAccess, PreviewLogin> = {
  full: { database: OWNER_GRANT, schemas: {}, databaseUser: "dbo", holdsFixture: true },
  partial: {
    database: NO_GRANT,
    schemas: { hr: OWNER_GRANT, sales: { definitions: false, data: true } },
    databaseUser: "reporting",
    holdsFixture: true,
  },
  nothing: { database: NO_GRANT, schemas: {}, databaseUser: "app_connect", holdsFixture: true },
  empty: { database: OWNER_GRANT, schemas: {}, databaseUser: "dbo", holdsFixture: false },
};

function grantIn(login: PreviewLogin, schema: string): Grant {
  const own = login.schemas[schema] ?? NO_GRANT;
  return {
    definitions: login.database.definitions || own.definitions,
    data: login.database.data || own.data,
  };
}

function seesSchema(login: PreviewLogin, schema: string): boolean {
  const grant = grantIn(login, schema);
  return grant.definitions || grant.data;
}

/** Permission facts the access probe reports for `login`. Every login sees its own denials. */
function probeOf(login: PreviewLogin): AccessProbe {
  const schemas = (login.holdsFixture ? ["dbo", "hr", "sales"] : ["dbo"]).map(
    (name): SchemaAccess => ({
      name,
      canReadDefinitions: grantIn(login, name).definitions,
      canReadData: grantIn(login, name).data,
      isDenied: false,
      hasVisibleObjects: login.holdsFixture && seesSchema(login, name),
    }),
  );
  return {
    canReadDefinitions: login.database.definitions,
    canReadData: login.database.data,
    explicitDenials: 0,
    seesObjects: schemas.some((schema) => schema.hasVisibleObjects),
    schemas,
    databaseUser: login.databaseUser,
  };
}

const LENGTH_TYPES = new Set(["char", "varchar", "nchar", "nvarchar", "binary", "varbinary"]);

/** Parses a declaration such as `INT`, `NVARCHAR(120)`, `VARCHAR(MAX)` or `DECIMAL(10,2)`. */
function dataType(declaration: string): SqlDataType {
  const [name = "int", argumentList = ""] = declaration.toLowerCase().split(/[()]/u);
  const [first = "", second] = argumentList.split(",");
  const plain: SqlDataType = {
    name,
    length: null,
    precision: null,
    scale: null,
    userDefinedTypeName: null,
  };
  if (first === "") {
    return plain;
  }
  if (LENGTH_TYPES.has(name)) {
    const length =
      first === "max"
        ? ({ kind: "max" } as const)
        : ({ kind: "fixed", value: Number.parseInt(first, 10) } as const);
    return { ...plain, length };
  }
  const precision = Number.parseInt(first, 10);
  return second === undefined
    ? { ...plain, precision }
    : { ...plain, precision, scale: Number.parseInt(second, 10) };
}

interface ColumnTraits {
  isNullable?: boolean;
  isIdentity?: boolean;
  isComputed?: boolean;
  /** `DEFAULT` expression as SQL Server stores it. */
  defaultText?: string;
}

function column(name: string, declaration: string, traits: ColumnTraits = {}): Column {
  return {
    name,
    ordinalPosition: 0,
    dataType: dataType(declaration),
    isNullable: traits.isNullable ?? false,
    defaultExpression:
      traits.defaultText === undefined ? null : { status: "readable", text: traits.defaultText },
    isIdentity: traits.isIdentity ?? false,
    isComputed: traits.isComputed ?? false,
  };
}

/**
 * A `CHECK` constraint with its expression in the normal form SQL Server stores. A disabled one
 * is never trusted; an enabled one is unless it was enabled again without checking the rows.
 */
function check(
  name: string,
  text: string,
  isEnabled = true,
  isTrusted = isEnabled,
): CheckConstraint {
  return { name, expression: { status: "readable", text }, isEnabled, isTrusted };
}

/** An index as a 1.2 capture records it: enabled, without a filter or included columns. */
function tableIndex(
  name: string,
  kind: Index["kind"],
  columns: string[],
  state: Partial<Pick<Index, "includedColumns" | "isFiltered" | "isEnabled">> = {},
): Index {
  return {
    name,
    columns,
    kind,
    isClustered: false,
    includedColumns: [],
    isFiltered: false,
    isEnabled: true,
    ...state,
  };
}

function table(schema: string, name: string, definition: Omit<Table, "name">): Table {
  return {
    name: { schema, name },
    ...definition,
    columns: definition.columns.map((item, index) => ({ ...item, ordinalPosition: index + 1 })),
  };
}

interface PreviewDatabase {
  tables: Table[];
  views: View[];
  foreignKeys: ForeignKey[];
}

/**
 * The fixture database every preview server holds, in the order inspectors list it. It has a
 * unique and a non-unique index, `DEFAULT` and `CHECK` texts in stored form (a reversed `IN`
 * chain, a `LIKE`, a function call and a disabled constraint), a computed column, a disabled
 * and a `SET NULL` foreign key, and keys across schemas, so the schema filter drops some. Every
 * state is recorded as a 1.2 capture records it: an index with an included column, a filtered
 * unique index and a disabled unique constraint on the columns of keys, a `CHECK` and a key SQL
 * Server marks as not trusted, and the rest enabled and trusted.
 */
function fixtureDatabase(): PreviewDatabase {
  return {
    tables: [
      table("dbo", "Customers", {
        columns: [
          column("CustomerId", "INT", { isIdentity: true }),
          column("Name", "NVARCHAR(120)"),
          column("Email", "VARCHAR(254)"),
          column("Notes", "NVARCHAR(MAX)", { isNullable: true }),
          column("CreatedAt", "DATETIME2(7)", { defaultText: "(sysutcdatetime())" }),
        ],
        primaryKey: {
          name: "PK_Customers",
          columns: ["CustomerId"],
          isClustered: true,
          isEnabled: true,
        },
        indexes: [tableIndex("UX_Customers_Email", "uniqueIndex", ["Email"])],
        checkConstraints: [
          check("CK_Customers_Email", "([Email] like '%_@_%')"),
          // Enabled again without checking the rows already there.
          check("CK_Customers_Name", "([dbo].[fn_valid_name]([Name])=(1))", true, false),
        ],
      }),
      table("hr", "Employees", {
        columns: [
          column("EmployeeId", "INT", { isIdentity: true }),
          column("FullName", "NVARCHAR(200)"),
          column("ManagerId", "INT", { isNullable: true }),
          column("HiredOn", "DATE", { defaultText: "(CONVERT([date],getdate()))" }),
        ],
        primaryKey: {
          name: "PK_Employees",
          columns: ["EmployeeId"],
          isClustered: true,
          isEnabled: true,
        },
        indexes: [],
        checkConstraints: [check("CK_Employees_Manager", "([ManagerId]<>[EmployeeId])", false)],
      }),
      table("sales", "OrderLines", {
        columns: [
          column("OrderId", "INT"),
          column("LineNumber", "SMALLINT"),
          column("ProductCode", "VARCHAR(32)"),
          column("Quantity", "INT", { defaultText: "((1))" }),
          column("UnitPrice", "DECIMAL(10,2)"),
          column("LineTotal", "DECIMAL(21,2)", { isNullable: true, isComputed: true }),
        ],
        primaryKey: {
          name: "PK_OrderLines",
          columns: ["OrderId", "LineNumber"],
          isClustered: true,
          isEnabled: true,
        },
        indexes: [],
        checkConstraints: [check("CK_OrderLines_Quantity", "([Quantity]>(0))")],
      }),
      table("sales", "Orders", {
        columns: [
          column("OrderId", "INT", { isIdentity: true }),
          column("CustomerId", "INT"),
          column("SalesRepId", "INT", { isNullable: true }),
          column("PlacedAt", "DATETIME2(7)", { defaultText: "(sysutcdatetime())" }),
          column("Status", "CHAR(1)", { defaultText: "('N')" }),
        ],
        primaryKey: { name: "PK_Orders", columns: ["OrderId"], isClustered: true, isEnabled: true },
        indexes: [
          tableIndex("IX_Orders_CustomerId", "nonUnique", ["CustomerId"], {
            includedColumns: ["PlacedAt"],
          }),
          // One open order per customer: a unique index over the rows of a filter only.
          tableIndex("UX_Orders_OpenCustomer", "uniqueIndex", ["CustomerId"], { isFiltered: true }),
          // A unique constraint whose index is disabled limits nothing.
          tableIndex("UQ_Orders_SalesRep", "uniqueConstraint", ["SalesRepId"], {
            isEnabled: false,
          }),
        ],
        checkConstraints: [
          check(
            "CK_Orders_Status",
            "([Status]='C' OR [Status]='S' OR [Status]='P' OR [Status]='N')",
          ),
        ],
      }),
    ],
    views: [
      {
        name: { schema: "sales", name: "RecentOrders" },
        columns: [column("OrderId", "INT"), column("CustomerName", "NVARCHAR(120)")].map(
          (item, index) => ({ ...item, ordinalPosition: index + 1 }),
        ),
      },
    ],
    foreignKeys: [
      {
        name: "FK_Employees_Manager",
        referencingTable: { schema: "hr", name: "Employees" },
        referencedTable: { schema: "hr", name: "Employees" },
        columnPairs: [{ referencingColumn: "ManagerId", referencedColumn: "EmployeeId" }],
        onDelete: "noAction",
        onUpdate: "noAction",
        isEnabled: false,
        isTrusted: false,
      },
      {
        // Added WITH NOCHECK: enabled, not trusted.
        name: "FK_OrderLines_Orders",
        referencingTable: { schema: "sales", name: "OrderLines" },
        referencedTable: { schema: "sales", name: "Orders" },
        columnPairs: [{ referencingColumn: "OrderId", referencedColumn: "OrderId" }],
        onDelete: "cascade",
        onUpdate: "noAction",
        isEnabled: true,
        isTrusted: false,
      },
      {
        name: "FK_Orders_Customers",
        referencingTable: { schema: "sales", name: "Orders" },
        referencedTable: { schema: "dbo", name: "Customers" },
        columnPairs: [{ referencingColumn: "CustomerId", referencedColumn: "CustomerId" }],
        onDelete: "noAction",
        onUpdate: "cascade",
        isEnabled: true,
        isTrusted: true,
      },
      {
        name: "FK_Orders_SalesRep",
        referencingTable: { schema: "sales", name: "Orders" },
        referencedTable: { schema: "hr", name: "Employees" },
        columnPairs: [{ referencingColumn: "SalesRepId", referencedColumn: "EmployeeId" }],
        onDelete: "setNull",
        onUpdate: "noAction",
        isEnabled: true,
        isTrusted: true,
      },
    ],
  };
}

/** The table as a login without `VIEW DEFINITION` sees it: every text exists but is hidden. */
function withHiddenTexts(source: Table): Table {
  return {
    ...source,
    columns: source.columns.map((item) =>
      item.defaultExpression === null
        ? item
        : { ...item, defaultExpression: { status: "notVisible" } },
    ),
    checkConstraints: source.checkConstraints.map((constraint) => ({
      ...constraint,
      expression: { status: "notVisible" },
    })),
  };
}

/**
 * What an inspection of the fixture returns for a login: the objects it sees inside the
 * scope, the texts it may read, and the keys split as the Rust assembly splits them. A key
 * whose referenced table the login sees outside the scope is dropped; one whose referenced
 * table it cannot see is kept apart. Views follow the schema scope like tables and are left
 * out altogether when `includeViews` is off.
 */
export function previewSnapshot(
  database: string,
  access: PreviewAccess = "full",
  options: InspectionOptions = EVERYTHING,
): SchemaSnapshot {
  const login = LOGINS[access];
  const fixture: PreviewDatabase = login.holdsFixture
    ? fixtureDatabase()
    : { tables: [], views: [], foreignKeys: [] };
  const inScope = (schema: string) =>
    options.schemas.length === 0 || options.schemas.includes(schema);

  const tables = fixture.tables
    .filter((item) => seesSchema(login, item.name.schema) && inScope(item.name.schema))
    .map((item) => (grantIn(login, item.name.schema).definitions ? item : withHiddenTexts(item)));
  const views = options.includeViews
    ? fixture.views.filter(
        (item) => seesSchema(login, item.name.schema) && inScope(item.name.schema),
      )
    : [];

  const included = new Set(tables.map((item) => nameKey(item.name)));
  const foreignKeys: ForeignKey[] = [];
  const toInvisibleTables: ForeignKeyToInvisibleTable[] = [];
  for (const key of fixture.foreignKeys) {
    if (!included.has(nameKey(key.referencingTable))) {
      continue;
    }
    if (included.has(nameKey(key.referencedTable))) {
      foreignKeys.push(key);
    } else if (!seesSchema(login, key.referencedTable.schema)) {
      toInvisibleTables.push({
        name: key.name,
        referencingTable: key.referencingTable,
        columns: key.columnPairs.map((pair) => pair.referencingColumn),
        onDelete: key.onDelete,
        onUpdate: key.onUpdate,
        isEnabled: key.isEnabled,
        ...(key.isTrusted === undefined ? {} : { isTrusted: key.isTrusted }),
      });
    }
  }

  // Empty lists are left out, as the Rust side leaves them out of the JSON.
  const invisible =
    toInvisibleTables.length > 0 ? { foreignKeysToInvisibleTables: toInvisibleTables } : {};
  const scope = { schemas: options.schemas, includeViews: options.includeViews };
  return {
    databaseName: database,
    serverVersion: "Microsoft SQL Server 2022 (preview)",
    extractedAt: new Date().toISOString(),
    access: observedAccess(probeOf(login), scope, { tables, views, ...invisible }),
    tables,
    views,
    foreignKeys,
    ...invisible,
  };
}

/** The count a stage reports, as the catalog queries would; `null` for stages without one. */
function stageCount(stage: InspectionStage, snapshot: SchemaSnapshot): number | null {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  switch (stage) {
    case "connecting":
    case "checkingAccess":
    case "assembling":
      return null;
    case "readingObjects":
      return snapshot.tables.length + snapshot.views.length;
    case "readingColumns":
      return sum([...snapshot.tables, ...snapshot.views].map((item) => item.columns.length));
    case "readingIndexes":
      return sum(
        snapshot.tables.map((item) => item.indexes.length + (item.primaryKey === null ? 0 : 1)),
      );
    case "readingForeignKeys":
      return snapshot.foreignKeys.length + (snapshot.foreignKeysToInvisibleTables?.length ?? 0);
    case "readingConstraints":
      return sum(snapshot.tables.map((item) => item.checkConstraints.length));
    case "completed":
      return snapshot.tables.length;
  }
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

  async describeDatabase(settings): Promise<DatabaseDescription> {
    await wait(300);
    const probe = probeOf(LOGINS[previewAccessFor(settings)]);
    return {
      schemas: probe.schemas
        .filter((schema) => schema.hasVisibleObjects)
        .map((schema) => schema.name),
      access: predictedAccess(probe),
    };
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

    const snapshot = previewSnapshot(
      settings.database ?? "Northwind",
      previewAccessFor(settings),
      options,
    );
    for (const stage of STAGES) {
      await wait(settings.host.includes("slow") ? 900 : 350);
      if (cancelledJobs.has(jobId)) {
        cancelledJobs.delete(jobId);
        throw inspectorError("cancelled", "the operation was cancelled");
      }
      onEvent({ event: "progress", data: { stage, count: stageCount(stage, snapshot) } });
    }
    return { ...snapshot, extractedAt: new Date().toISOString() };
  },

  cancelInspection(jobId): Promise<void> {
    cancelledJobs = new Set([...cancelledJobs, jobId]);
    return Promise.resolve();
  },
};
