import { describe, expect, it } from "vitest";

import type {
  Column,
  ModuleBody,
  Parameter,
  Programmability,
  Routine,
  SchemaSnapshot,
  SqlDataType,
  Trigger,
} from "@/shared/contracts";
import { previewSnapshot } from "@/shared/ipc/previewConnectionBackend";

import { describeModuleDetails, describeViewDefinition } from "./moduleDetails";
import type { ModuleDefinitionFacts } from "./moduleDetails";
import type { ModuleRef } from "./modules";
import type { DetailsScope } from "./objectDetails";

const TYPE: SqlDataType = {
  name: "int",
  length: null,
  precision: null,
  scale: null,
  userDefinedTypeName: null,
};
const REF: ModuleRef = { kind: "routine", name: { schema: "sales", name: "PlaceOrder" } };
const BODY: ModuleBody = {
  language: "sql",
  definition: { status: "readable", text: "CREATE PROCEDURE sales.PlaceOrder AS SELECT 1;\r\n" },
};
const SCOPE: DetailsScope = {
  hiddenKeys: new Set(),
  coverage: null,
  carriedOver: [],
  isSchemaFiltered: false,
  isDiagramOnly: false,
  definitions: "included",
};
const READ_AT = "2026-10-12T08:00:00Z";

function parameter(name: string, ordinalPosition: number): Parameter {
  return { name, ordinalPosition, dataType: TYPE, isOutput: false, isReadOnly: false };
}

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    name: { schema: "sales", name: "PlaceOrder" },
    kind: "procedure",
    body: BODY,
    parameters: [],
    returns: null,
    columns: [],
    ...overrides,
  };
}

function snapshot(overrides: Partial<Programmability> = {}): SchemaSnapshot {
  return {
    ...previewSnapshot("Shop", "full"),
    programmability: {
      capture: { objects: { status: "read" }, definitions: { status: "read" } },
      routines: [routine()],
      views: [],
      triggers: [],
      ...overrides,
    },
  };
}

function definition(capture: SchemaSnapshot): ModuleDefinitionFacts | undefined {
  return describeModuleDetails(capture, REF, SCOPE)?.sections.find(
    (section) => section.kind === "definition",
  )?.definition;
}

describe("module details", () => {
  it("orders procedure parameters without inventing defaults or changing the snapshot", () => {
    const params = [
      parameter("@Second", 2),
      { ...parameter("@First", 1), isOutput: true, isReadOnly: true },
    ];
    const details = describeModuleDetails(
      snapshot({ routines: [routine({ parameters: params })] }),
      REF,
      SCOPE,
    );
    expect(details?.sections.map((section) => section.kind)).toEqual(["parameters", "definition"]);
    expect(details?.sections[0]).toMatchObject({
      items: [{ name: "@First", isOutput: true, isReadOnly: true }, { name: "@Second" }],
      hasSqlDefaultsNote: true,
    });
    expect(params.map((item) => item.name)).toEqual(["@Second", "@First"]);
  });

  it("gives scalar and aggregate functions a return type, and table functions ordered columns", () => {
    for (const kind of ["scalarFunction", "aggregateFunction"] as const) {
      const details = describeModuleDetails(
        snapshot({ routines: [routine({ kind, returns: TYPE })] }),
        REF,
        SCOPE,
      );
      expect(details?.sections.map((section) => section.kind)).toEqual([
        "parameters",
        "returns",
        "definition",
      ]);
      expect(details?.sections[1]).toEqual({ kind: "returns", scalarType: "int", columns: null });
    }
    const column: Column = {
      name: "Result",
      ordinalPosition: 1,
      dataType: TYPE,
      isNullable: false,
      isIdentity: false,
      isComputed: false,
      defaultExpression: null,
    };
    for (const kind of ["inlineTableFunction", "tableFunction"] as const) {
      expect(
        describeModuleDetails(
          snapshot({ routines: [routine({ kind, columns: [column] })] }),
          REF,
          SCOPE,
        )?.sections[1],
      ).toEqual({ kind: "returns", scalarType: null, columns: [column] });
    }
  });

  it("never calls an unknown routine a procedure or function", () => {
    expect(
      describeModuleDetails(snapshot({ routines: [routine({ kind: "unknown" })] }), REF, SCOPE)
        ?.kind,
    ).toBe("unknown");
    expect(describeModuleDetails(snapshot({ routines: [] }), REF, SCOPE)).toBeNull();
  });

  it("maps every body state and keeps unknown states conservative", () => {
    const bodies: [ModuleBody, ModuleDefinitionFacts["status"]][] = [
      [BODY, "readable"],
      [{ language: "clr" }, "clr"],
      [{ language: "unknown" }, "notVisible"],
      ...(["notVisible", "encrypted", "notRecorded", "unknown"] as const).map(
        (status): [ModuleBody, ModuleDefinitionFacts["status"]] => [
          { language: "sql", definition: { status } },
          status === "unknown" ? "notVisible" : status,
        ],
      ),
    ];
    for (const [body, status] of bodies) {
      expect(definition(snapshot({ routines: [routine({ body })] }))?.status).toBe(status);
    }
    expect(definition(snapshot())?.text).toBe("CREATE PROCEDURE sales.PlaceOrder AS SELECT 1;\r\n");
  });

  it("separates omitted code from failed reads and retains the last verified date", () => {
    for (const reason of ["optionOff", "queryFailed", "timedOut", "unknown"] as const) {
      const capture = snapshot({
        routines: [routine({ body: { language: "sql", definition: { status: "notRecorded" } } })],
        capture: { objects: { status: "read" }, definitions: { status: "notRead", reason } },
      });
      expect(definition(capture)).toMatchObject({ status: "notRead", reason, text: null });
    }
    const capture = snapshot({
      carriedOver: [
        { object: REF, part: "whole", readAt: READ_AT },
        { object: REF, part: "definition", readAt: "2026-10-10T08:00:00Z" },
      ],
    });
    expect(describeModuleDetails(capture, REF, SCOPE)?.notCheckedSince).toBe(READ_AT);
    expect(definition(capture)).toMatchObject({
      status: "readable",
      notCheckedSince: "2026-10-10T08:00:00Z",
    });
    expect(
      definition(
        snapshot({
          routines: [routine({ body: { language: "sql", definition: { status: "encrypted" } } })],
          carriedOver: [{ object: REF, part: "definition", readAt: READ_AT }],
        }),
      ),
    ).toMatchObject({ status: "encrypted", notCheckedSince: READ_AT });
  });

  it("gives triggers their parent and disables links for hidden or missing parents", () => {
    const trigger: Trigger = {
      parent: { schema: "sales", name: "Orders" },
      name: "Audit",
      timing: "after",
      events: [{ event: "insert", order: "first" }],
      isEnabled: true,
      isNotForReplication: false,
      body: BODY,
    };
    const ref: ModuleRef = { kind: "trigger", parent: trigger.parent, name: trigger.name };
    const capture = snapshot({ triggers: [trigger] });
    expect(
      describeModuleDetails(capture, ref, SCOPE)?.sections.map((section) => section.kind),
    ).toEqual(["runs", "definition"]);
    expect(describeModuleDetails(capture, ref, SCOPE)?.sections[0]).toMatchObject({
      parent: { key: "sales.Orders", kind: "table", unavailable: null },
    });
    expect(
      describeModuleDetails(capture, ref, { ...SCOPE, hiddenKeys: new Set(["sales.Orders"]) })
        ?.sections[0],
    ).toMatchObject({ parent: { key: null, unavailable: "hidden" } });
    expect(
      describeModuleDetails({ ...capture, tables: [] }, ref, SCOPE)?.sections[0],
    ).toMatchObject({ parent: { key: null, unavailable: "unknown" } });
  });

  it("reads view code separately from entity details and represents legacy absence honestly", () => {
    const base = previewSnapshot("Shop", "full");
    delete base.programmability;
    const view = base.views[0];
    if (view === undefined) throw new Error("view fixture missing");
    const key = `${view.name.schema}.${view.name.name}`;
    expect(describeViewDefinition(base, key)).toMatchObject({
      status: "notRecorded",
      viewSettings: null,
    });
    expect(describeViewDefinition(base, "sales.Orders")).toBeNull();
    expect(
      describeViewDefinition(
        snapshot({
          views: [
            {
              view: view.name,
              definition: { status: "readable", text: "SELECT 1;" },
              hasCheckOption: true,
              isIndexed: true,
            },
          ],
        }),
        key,
      ),
    ).toMatchObject({
      status: "readable",
      text: "SELECT 1;",
      viewSettings: { hasCheckOption: true, isIndexed: true },
    });
  });
});
