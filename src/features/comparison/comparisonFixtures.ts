import type { ComparisonItem, OpenedProject, ProjectComparison } from "@/shared/contracts";

/** Synthetic records shared only by comparison contract/race/privacy tests. */
export function comparisonFixture(): ProjectComparison {
  const capture = {
    provider: "sqlServer" as const,
    extractedAt: "2026-10-23T10:00:00Z",
    scope: null,
    accessLevel: null,
    hasUnknownExtensions: false,
  };
  return {
    reference: capture,
    compared: capture,
    items: [comparisonItemFixture()],
    summary: {
      objectsCompared: 1,
      equal: 0,
      onlyReference: 0,
      onlyCompared: 0,
      different: 1,
      notComparable: 0,
      withLimitations: 0,
    },
  };
}

export function comparisonItemFixture(): ComparisonItem {
  const observation = { status: "observed" as const, readAt: "2026-10-23T10:00:00Z" };
  return {
    object: {
      kind: "table",
      name: { schema: "sales", name: "Orders" },
      memberName: null,
      identityArguments: null,
    },
    result: "different",
    reference: observation,
    compared: observation,
    properties: [
      {
        path: ["columns", "Total", "nullability"],
        result: "different",
        reference: { observation, value: "false" },
        compared: { observation, value: "true" },
      },
    ],
    definitionText: null,
  };
}

export function comparisonDocumentFixture(): OpenedProject {
  return {
    isReadOnly: false,
    project: {
      formatVersion: 4,
      minReaderVersion: 4,
      savedAt: "2026-10-23T10:00:00Z",
      savedWith: "SchemaCraft 1.2.0",
      connection: {
        provider: "sqlServer",
        host: "PRIVATE_HOST",
        instance: null,
        port: 14335,
        database: "Synthetic",
        authentication: { mode: "sqlLogin", username: "PRIVATE_LOGIN" },
        encryption: "mandatory",
        trustServerCertificate: true,
      },
      inspection: {
        schemas: [],
        includeViews: true,
        includeProgrammability: true,
        includeModuleDefinitions: true,
        includeDependencies: true,
      },
      snapshot: {
        provider: "sqlServer",
        databaseName: "Synthetic",
        serverVersion: null,
        extractedAt: "2026-10-23T10:00:00Z",
        tables: [
          {
            name: { schema: "sales", name: "Orders" },
            columns: [],
            primaryKey: null,
            indexes: [],
            checkConstraints: [],
          },
        ],
        views: [],
        foreignKeys: [],
      },
      canvas: {
        detailLevel: "keys",
        layout: "manual",
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          {
            name: { schema: "sales", name: "Orders" },
            position: { x: 0, y: 0 },
            isCollapsed: false,
            isHidden: false,
          },
        ],
      },
      perspectives: [],
      annotations: { notes: [] },
    },
  };
}
