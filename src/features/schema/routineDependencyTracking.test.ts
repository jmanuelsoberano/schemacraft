import { describe, expect, it } from "vitest";

import type { Routine, SchemaSnapshot } from "@/shared/contracts";
import type { RoutineDependencyTracking } from "@/shared/contracts/generated/model/RoutineDependencyTracking";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";
import { previewPostgreSqlSnapshot } from "@/shared/ipc/previewPostgreSql";

import { describeModuleDetails } from "./moduleDetails";
import { presentModuleDetails } from "./moduleDetailsView";
import { listModules, routineRef } from "./modules";
import { presentRoutineDependencyTracking } from "./routineDependencyTracking";

const name = { schema: "sales", name: "order_total" };
const argumentsIdentity = [{ schema: "pg_catalog", name: "int4" }];
const routine: Routine = {
  name,
  identityArguments: argumentsIdentity,
  kind: "scalarFunction",
  parameters: [],
  returns: null,
  columns: [],
  body: { language: "postgreSql", name: "sql", definition: { status: "notRecorded" } },
};
function captured(tracking: RoutineDependencyTracking | undefined): SchemaSnapshot {
  const snapshot = previewPostgreSqlSnapshot("synthetic", {
    schemas: [],
    includeViews: true,
    includeProgrammability: true,
    includeModuleDefinitions: false,
  });
  if (snapshot.programmability === undefined || snapshot.postgresql === undefined)
    throw new Error("native fixture required");
  snapshot.programmability.routines = [routine];
  snapshot.postgresql.routines = [
    {
      object: routineRef(routine),
      language: "sql",
      returnsSet: false,
      arguments: null,
      result: "numeric",
      argumentModes: [],
      definitionIsReconstructed: true,
      ...(tracking === undefined ? {} : { routineBodyTracking: tracking }),
    },
  ];
  return snapshot;
}

describe("native routine-body dependency evidence", () => {
  it.each(["parsedSqlBody", "signatureOnly", "unknown", undefined] as const)(
    "preserves %s with source storage disabled in both module details and lists",
    (state) => {
      const snapshot = captured(state);
      expect(listModules(snapshot)[0]?.routineBodyTracking).toBe(state ?? "notRecorded");
      const details = describeModuleDetails(snapshot, routineRef(routine), {
        hiddenKeys: new Set(),
        coverage: null,
        carriedOver: [],
        isSchemaFiltered: false,
        isDiagramOnly: false,
        definitions: "included",
      });
      if (details === null) throw new Error("module details required");
      for (const locale of ["en", "es"] as const) {
        const translator = createCatalogTranslator(messageCatalogs[locale], locale);
        const parameters = presentModuleDetails(details, translator).sections.find(
          (section) => section.kind === "parameters",
        );
        expect(parameters?.tracking).toEqual(presentRoutineDependencyTracking(state, translator));
        expect(parameters?.tracking?.explanation.length).toBeGreaterThan(30);
      }
      expect(snapshot.programmability?.capture.definitions).toEqual({
        status: "notRead",
        reason: "optionOff",
      });
      expect(snapshot.programmability?.routines[0]?.body).toMatchObject({
        definition: { status: "notRecorded" },
      });
    },
  );

  it("does not infer body tracking from the language or invent it for SQL Server", () => {
    const legacy = captured(undefined);
    expect(listModules(legacy)[0]?.routineBodyTracking).toBe("notRecorded");
    const sqlServer = { ...legacy, provider: "sqlServer" as const };
    expect(listModules(sqlServer)[0]).not.toHaveProperty("routineBodyTracking");
  });
});
