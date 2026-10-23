/** Synthetic PostgreSQL catalogs for the explicitly simulated browser preview. */
import type { Column, InspectionOptions, SchemaSnapshot } from "@/shared/contracts";

function column(name: string, ordinalPosition: number, declaration: string): Column {
  return {
    name,
    ordinalPosition,
    dataType: {
      name: declaration,
      nativeDeclaration: declaration,
      length: null,
      precision: null,
      scale: null,
      userDefinedTypeName: null,
    },
    isNullable: false,
    defaultExpression: null,
    isIdentity: false,
    isComputed: false,
  };
}

export function previewPostgreSqlSnapshot(
  database: string,
  options: InspectionOptions,
): SchemaSnapshot {
  const date = new Date().toISOString();
  const inScope = options.schemas.length === 0 || options.schemas.includes("public");
  const tables = inScope
    ? [
        {
          name: { schema: "public", name: "customers" },
          columns: [column("customer_id", 1, "integer"), column("name", 2, "text")],
          primaryKey: null,
          indexes: [],
          checkConstraints: [],
        },
        {
          name: { schema: "public", name: "orders" },
          columns: [
            column("order_id", 1, "integer"),
            column("customer_id", 2, "integer"),
            column("total", 3, "numeric(12,2)"),
          ],
          primaryKey: null,
          indexes: [],
          checkConstraints: [],
        },
      ]
    : [];
  const views =
    options.includeViews && inScope
      ? [
          {
            name: { schema: "public", name: "order_totals" },
            columns: [column("customer_id", 1, "integer"), column("total", 2, "numeric")],
          },
        ]
      : [];
  const definitions = options.includeProgrammability && options.includeModuleDefinitions;
  return {
    provider: "postgreSql",
    databaseName: database,
    serverVersion: "PostgreSQL 18 (simulated browser preview)",
    extractedAt: date,
    tables,
    views,
    foreignKeys: [],
    postgresql: {
      tables: tables.map((table) => ({ name: table.name, kind: "ordinary" })),
      columns: [...tables, ...views].flatMap((object) =>
        object.columns.map((item) => ({
          object: object.name,
          name: item.name,
          typeName: {
            schema: "pg_catalog",
            name: item.dataType.name.startsWith("numeric") ? "numeric" : item.dataType.name,
          },
          typeKind: "base",
          identityGeneration: null,
          generation: null,
          generationExpression: null,
        })),
      ),
      views: views.map((view) => ({
        name: view.name,
        isMaterialized: false,
        isPopulated: null,
        checkOption: "none",
      })),
      indexes: [],
      constraints: [],
      routines: [],
      triggers: [],
    },
    access: {
      postgresql: {
        objectCatalogRead: true,
        programmabilityCatalogRead: options.includeProgrammability,
        definitions: definitions ? { status: "read" } : { status: "notRead", reason: "optionOff" },
        schemas: [
          {
            name: "public",
            hasUsage: true,
            hasVisibleObjects: true,
            hasVisibleProgrammability: false,
          },
        ],
      },
      scope: { ...options },
      level: inScope ? "full" : "empty",
      coverage: {
        objects: "complete",
        definitions: "complete",
        ...(options.includeProgrammability
          ? ({
              programmability: "complete",
              moduleDefinitions: definitions ? "complete" : "notAvailable",
            } as const)
          : {}),
      },
      counts: {
        definitions: 0,
        definitionsNotVisible: 0,
        foreignKeysToInvisibleTables: 0,
        moduleDefinitions: definitions ? views.length : 0,
        moduleDefinitionsNotVisible: 0,
        moduleDefinitionsEncrypted: 0,
      },
    },
    programmability: {
      capture: {
        objects: options.includeProgrammability
          ? { status: "read" }
          : { status: "notRead", reason: "optionOff" },
        definitions: definitions ? { status: "read" } : { status: "notRead", reason: "optionOff" },
      },
      routines: [],
      triggers: [],
      views: options.includeProgrammability
        ? views.map((view) => ({
            view: view.name,
            hasCheckOption: false,
            isIndexed: false,
            definition: definitions
              ? {
                  status: "readable",
                  text: "CREATE VIEW public.order_totals AS SELECT customer_id, sum(total) AS total FROM public.orders GROUP BY customer_id;",
                }
              : { status: "notRecorded" },
          }))
        : [],
    },
    dependencies: {
      capture: options.includeDependencies
        ? { status: "read" }
        : { status: "notRead", reason: "optionOff" },
      observedAt: date,
      scope: { ...options },
      edges:
        options.includeDependencies && views.length > 0
          ? [
              {
                source: { kind: "view", name: { schema: "public", name: "order_totals" } },
                target: {
                  kind: "object",
                  object: { kind: "table", name: { schema: "public", name: "orders" } },
                },
                kind: "catalogReference",
                isSchemaBound: null,
                readAt: date,
                retained: false,
              },
            ]
          : [],
      sources: options.includeDependencies
        ? [
            ...tables.map((table) => ({
              object: { kind: "table" as const, name: table.name },
              coverage: "complete" as const,
              readAt: date,
              retained: false,
            })),
            ...views.map((view) => ({
              object: { kind: "view" as const, name: view.name },
              coverage: "complete" as const,
              readAt: date,
              retained: false,
            })),
          ]
        : [],
      limitations: ["runtimeReferencesNotTracked", "routineBodiesNotFullyTracked"],
    },
  };
}
