/** Code capture and refresh samples for the browser preview; Rust remains the authoritative diff. */
import type {
  AccessProfile,
  AvailableCode,
  CaptureChange,
  CaptureState,
  CarriedCode,
  CodeChange,
  CodeCounts,
  CodeDiff,
  CodeObjectRef,
  Definition,
  InspectionOptions,
  ModuleBody,
  Programmability,
  QualifiedName,
  Routine,
  SchemaSnapshot,
  SqlDataType,
  Trigger,
  ViewModule,
} from "@/shared/contracts";

const key = (value: unknown) => JSON.stringify(value);
const sameName = (left: QualifiedName, right: QualifiedName) =>
  left.schema === right.schema && left.name === right.name;
const name = (schema: string, value: string): QualifiedName => ({ schema, name: value });
const int: SqlDataType = {
  name: "int",
  length: null,
  precision: null,
  scale: null,
  userDefinedTypeName: null,
};
const sql = (text: string): ModuleBody => ({
  language: "sql",
  definition: { status: "readable", text },
});
const read: CaptureState = { status: "read" };
const leftOut: CaptureState = { status: "notRead", reason: "optionOff" };
const isOff = (state: CaptureState) => state.status === "notRead" && state.reason === "optionOff";

export type PreviewCodeFailure = "objects" | "definitions" | "timeout";

/** A separate browser sample exercises long lists and every Inspector definition state. */
function explorerFixture(): Programmability {
  const code = fixture();
  const routines: Routine[] = Array.from({ length: 600 }, (_, index) => ({
    name: name("sales", `usp_Example${String(index + 1).padStart(3, "0")}`),
    kind: "procedure",
    parameters: [],
    returns: null,
    columns: [],
    body: sql(
      `CREATE PROCEDURE sales.usp_Example${String(index + 1).padStart(3, "0")} AS SELECT ${index + 1};`,
    ),
  }));
  const sample = (index: number, body: ModuleBody) => {
    const routine = routines[index];
    if (routine !== undefined) routine.body = body;
  };
  sample(
    0,
    sql(
      [
        "CREATE PROCEDURE sales.usp_Example001 AS",
        ...Array.from(
          { length: 1999 },
          (_, index) => `-- Detail ${index + 1}: a stored line of SQL.`,
        ),
      ].join("\n"),
    ),
  );
  sample(1, { language: "clr" });
  sample(2, { language: "sql", definition: { status: "notRecorded" } });
  sample(3, { language: "unknown" });
  sample(4, { language: "sql", definition: { status: "notVisible" } });
  sample(5, { language: "sql", definition: { status: "encrypted" } });
  return {
    ...code,
    routines: [
      ...code.routines.filter(
        (routine) => routine.name.schema !== "sales" || routine.kind !== "procedure",
      ),
      ...routines,
    ],
    carriedOver: [
      {
        object: { kind: "routine", name: name("sales", "usp_Example007") },
        part: "definition",
        readAt: "2026-10-18T12:00:00Z",
      },
    ],
  };
}

/** Representative code.sql facts: parameters, TVP, scalar/table results, encryption and per-event order. */
function fixture(): Programmability {
  const routine = (
    schema: string,
    value: string,
    kind: Routine["kind"],
    body: ModuleBody,
  ): Routine => ({
    name: name(schema, value),
    kind,
    body,
    parameters: [],
    returns: kind === "scalarFunction" ? int : null,
    columns: [],
  });
  const resultColumn = {
    name: "OrderId",
    ordinalPosition: 1,
    dataType: int,
    isNullable: false,
    isIdentity: false,
    isComputed: false,
    defaultExpression: null,
  };
  const placeOrder = routine(
    "sales",
    "usp_PlaceOrder",
    "procedure",
    sql(
      "-- Orders entered by the application.\nCREATE PROCEDURE sales.usp_PlaceOrder @CustomerId int, @OrderId int OUTPUT AS SELECT @OrderId = @CustomerId;",
    ),
  );
  placeOrder.parameters = [
    { name: "@CustomerId", ordinalPosition: 1, dataType: int, isOutput: false, isReadOnly: false },
    { name: "@OrderId", ordinalPosition: 2, dataType: int, isOutput: true, isReadOnly: false },
  ];
  const tableInput = routine(
    "sales",
    "usp_SaveLines",
    "procedure",
    sql(
      "CREATE PROCEDURE sales.usp_SaveLines @Lines sales.OrderLineType READONLY AS SELECT COUNT(*) FROM @Lines;",
    ),
  );
  tableInput.parameters = [
    {
      name: "@Lines",
      ordinalPosition: 1,
      dataType: { ...int, name: "table", userDefinedTypeName: "sales.OrderLineType" },
      isOutput: false,
      isReadOnly: true,
    },
  ];
  const inline = routine(
    "sales",
    "fn_OrdersOf",
    "inlineTableFunction",
    sql(
      "CREATE FUNCTION sales.fn_OrdersOf(@CustomerId int) RETURNS TABLE AS RETURN SELECT OrderId FROM sales.Orders WHERE CustomerId = @CustomerId;",
    ),
  );
  inline.columns = [resultColumn];
  const tableFunction = routine(
    "sales",
    "fn_OpenOrders",
    "tableFunction",
    sql(
      "CREATE FUNCTION sales.fn_OpenOrders() RETURNS @Orders TABLE(OrderId int) AS BEGIN INSERT @Orders SELECT OrderId FROM sales.Orders; RETURN; END;",
    ),
  );
  tableFunction.columns = [resultColumn];
  const trigger = (value: string, enabled = true): Trigger => ({
    parent: name("sales", "Orders"),
    name: value,
    timing: "after",
    events: [
      { event: "insert", order: "first" },
      { event: "update", order: "unspecified" },
    ],
    isEnabled: enabled,
    isNotForReplication: false,
    body: sql(
      `CREATE TRIGGER sales.${value} ON sales.Orders AFTER INSERT, UPDATE AS SET NOCOUNT ON;`,
    ),
  });
  return {
    capture: { objects: read, definitions: read },
    views: [
      {
        view: name("sales", "RecentOrders"),
        definition: {
          status: "readable",
          text: "CREATE VIEW sales.RecentOrders AS SELECT OrderId FROM sales.Orders;",
        },
        hasCheckOption: false,
        isIndexed: false,
      },
    ],
    routines: [
      routine(
        "code_only",
        "usp_Heartbeat",
        "procedure",
        sql("CREATE PROCEDURE code_only.usp_Heartbeat AS SELECT 1;"),
      ),
      routine(
        "dbo",
        "fn_Tax",
        "scalarFunction",
        sql(
          "CREATE FUNCTION dbo.fn_Tax(@Amount int) RETURNS int AS BEGIN RETURN @Amount / 10; END;",
        ),
      ),
      inline,
      tableFunction,
      routine(
        "sales",
        "usp_Crlf",
        "procedure",
        sql("CREATE PROCEDURE sales.usp_Crlf\r\nAS\r\nSELECT 1;  \r\n"),
      ),
      placeOrder,
      tableInput,
      routine("sales", "usp_Secret", "procedure", {
        language: "sql",
        definition: { status: "encrypted" },
      }),
    ],
    triggers: [
      trigger("TR_Orders_Audit"),
      {
        ...trigger("TR_Orders_Disabled", false),
        events: [{ event: "update", order: "unspecified" }],
      },
      {
        ...trigger("TR_Orders_Delete"),
        events: [{ event: "delete", order: "last" }],
        isNotForReplication: true,
      },
      {
        ...trigger("TR_RecentOrders_Insert"),
        parent: name("sales", "RecentOrders"),
        timing: "insteadOf",
        events: [{ event: "insert", order: "unspecified" }],
      },
    ],
  };
}

export function codeCounts(code: Programmability): CodeCounts {
  const procedures = code.routines.filter((routine) => routine.kind === "procedure").length;
  return {
    procedures,
    functions: code.routines.length - procedures,
    views: code.views.length,
    triggers: code.triggers.length,
  };
}

export function moduleDefinitions(code: Programmability): Definition[] {
  return [
    ...code.views.map((module) => module.definition),
    ...[...code.routines, ...code.triggers].flatMap((module) =>
      module.body.language === "sql" ? [module.body.definition] : [],
    ),
  ];
}

/** The preview applies the same object and text options separately, including failure states. */
export function previewProgrammability(
  snapshot: Pick<SchemaSnapshot, "tables" | "views">,
  options: InspectionOptions,
  canRead: (schema: string) => boolean,
  holdsFixture: boolean,
  failure?: PreviewCodeFailure,
  explorer = false,
): Programmability {
  const objects = !options.includeProgrammability
    ? leftOut
    : failure === "objects" || failure === "timeout"
      ? ({
          status: "notRead",
          reason: failure === "timeout" ? "timedOut" : "queryFailed",
        } as const)
      : read;
  const definitions = !options.includeModuleDefinitions
    ? leftOut
    : failure === "definitions"
      ? ({ status: "notRead", reason: "queryFailed" } as const)
      : objects;
  const code =
    holdsFixture && objects.status === "read"
      ? explorer
        ? explorerFixture()
        : fixture()
      : { views: [], routines: [], triggers: [] };
  const scoped = (schema: string) =>
    options.schemas.length === 0 || options.schemas.includes(schema);
  const text = (definition: Definition, schema: string): Definition =>
    isOff(definitions)
      ? { status: "notRecorded" }
      : definition.status === "encrypted"
        ? definition
        : definitions.status !== "read"
          ? { status: "notRecorded" }
          : canRead(schema)
            ? definition
            : { status: "notVisible" };
  const body = (value: ModuleBody, schema: string): ModuleBody =>
    value.language === "sql"
      ? { language: "sql", definition: text(value.definition, schema) }
      : value;
  const held = (parent: QualifiedName) =>
    [...snapshot.tables, ...snapshot.views].some((object) => sameName(object.name, parent));
  return {
    capture: { objects, definitions },
    routines: code.routines
      .filter(
        (routine) =>
          scoped(routine.name.schema) &&
          (canRead(routine.name.schema) ||
            ((routine.kind === "inlineTableFunction" || routine.kind === "tableFunction") &&
              snapshot.tables.some((table) => table.name.schema === routine.name.schema))),
      )
      .map((routine) => ({ ...routine, body: body(routine.body, routine.name.schema) }))
      .sort((left, right) => key(left.name).localeCompare(key(right.name))),
    views: code.views
      .filter((module) => snapshot.views.some((view) => sameName(view.name, module.view)))
      .map((module) => ({ ...module, definition: text(module.definition, module.view.schema) })),
    triggers: code.triggers
      .filter((trigger) => held(trigger.parent))
      .map((trigger) => ({ ...trigger, body: body(trigger.body, trigger.parent.schema) })),
    ...("carriedOver" in code &&
    definitions.status === "read" &&
    scoped("sales") &&
    canRead("sales")
      ? { carriedOver: code.carriedOver }
      : {}),
  };
}

export function withCodeCoverage(access: AccessProfile, code: Programmability): AccessProfile {
  // Native PostgreSQL evidence is produced by its own preview fixture, never SQL grant rules.
  if (access.probe === undefined) return access;
  const definitions = moduleDefinitions(code);
  const hidden = definitions.filter((definition) => definition.status === "notVisible").length;
  const readable = definitions.filter((definition) => definition.status === "readable").length;
  const allObjects =
    access.probe.explicitDenials === 0 &&
    access.probe.executeDenials === 0 &&
    access.probe.schemas
      .filter(
        (schema) => access.scope.schemas.length === 0 || access.scope.schemas.includes(schema.name),
      )
      .every((schema) => schema.canReadDefinitions && !schema.isDenied && !schema.isExecuteDenied);
  return {
    ...access,
    coverage: {
      ...access.coverage,
      programmability:
        code.capture.objects.status !== "read"
          ? "notAvailable"
          : allObjects
            ? "complete"
            : "partial",
      moduleDefinitions:
        code.capture.definitions.status !== "read"
          ? "notAvailable"
          : hidden === 0
            ? "complete"
            : readable === 0
              ? "notAvailable"
              : "partial",
    },
    counts: {
      ...access.counts,
      moduleDefinitions: definitions.length,
      moduleDefinitionsNotVisible: hidden,
      moduleDefinitionsEncrypted: definitions.filter(
        (definition) => definition.status === "encrypted",
      ).length,
    },
  };
}

interface CodeEntry {
  object: CodeObjectRef;
  value: Routine | Trigger | ViewModule;
  definition: Definition | null;
  routineKind: Routine["kind"] | null;
}
function entries(code: Programmability): CodeEntry[] {
  return [
    ...code.views.map((value): CodeEntry => ({
      object: { kind: "view", name: value.view },
      value,
      definition: value.definition,
      routineKind: null,
    })),
    ...code.routines.map((value): CodeEntry => ({
      object: { kind: "routine", name: value.name },
      value,
      definition: value.body.language === "sql" ? value.body.definition : null,
      routineKind: value.kind,
    })),
    ...code.triggers.map((value): CodeEntry => ({
      object: { kind: "trigger", parent: value.parent, name: value.name },
      value,
      definition: value.body.language === "sql" ? value.body.definition : null,
      routineKind: null,
    })),
  ];
}
function setDefinition(entry: CodeEntry, definition: Definition): void {
  if ("definition" in entry.value) entry.value.definition = definition;
  else if (entry.value.body.language === "sql") entry.value.body.definition = definition;
}
const recordsObjects = (code?: Programmability) =>
  code !== undefined && (code.capture.objects.status === "read" || entries(code).length > 0);
const recordsTexts = (code?: Programmability) =>
  code !== undefined &&
  (code.capture.definitions.status === "read" ||
    moduleDefinitions(code).some((definition) => definition.status === "readable"));

function vouches(snapshot: SchemaSnapshot, object: CodeObjectRef): boolean {
  if (snapshot.programmability?.capture.objects.status !== "read") return false;
  if (object.kind === "trigger" || object.kind === "view") {
    const parent = object.kind === "trigger" ? object.parent : object.name;
    return (
      [...snapshot.tables, ...snapshot.views].some((value) => sameName(value.name, parent)) &&
      !(snapshot.carriedOver ?? []).some(
        (fact) =>
          sameName(fact.object, parent) &&
          (fact.fact.kind === "table" || fact.fact.kind === "view"),
      )
    );
  }
  if (object.kind === "unknown") return false;
  const access = snapshot.access;
  if (access === undefined) return true;
  if (access.probe === undefined)
    return (
      access.postgresql?.programmabilityCatalogRead === true &&
      access.scope.includeProgrammability === true &&
      (access.scope.schemas.length === 0 || access.scope.schemas.includes(object.name.schema))
    );
  const schema = access.probe.schemas.find((value) => value.name === object.name.schema);
  return (
    (access.scope.schemas.length === 0 || access.scope.schemas.includes(object.name.schema)) &&
    access.probe.explicitDenials === 0 &&
    access.probe.executeDenials === 0 &&
    (schema?.canReadDefinitions ?? access.probe.canReadDefinitions) &&
    !schema?.isDenied &&
    !schema?.isExecuteDenied
  );
}

/** Called after tables and views are merged, so a kept parent's original date is available. */
export function withUncheckedCode(
  merged: SchemaSnapshot,
  previous: SchemaSnapshot,
): SchemaSnapshot {
  const saved = previous.programmability;
  if (saved === undefined || !recordsObjects(saved)) return merged;
  const code = structuredClone(
    merged.programmability ??
      ({
        capture: { objects: { status: "unknown" }, definitions: { status: "unknown" } },
        routines: [],
        triggers: [],
        views: [],
      } satisfies Programmability),
  );
  if (isOff(code.capture.objects)) return merged;
  const textsOff = isOff(code.capture.definitions);
  const previousFacts = saved.carriedOver ?? [];
  const carried = new Map(
    (code.carriedOver ?? []).map((fact) => [key([fact.object, fact.part]), fact]),
  );
  const record = (object: CodeObjectRef, part: CarriedCode["part"], parentReadAt?: string) => {
    const earlier =
      previousFacts.find((fact) => key(fact.object) === key(object) && fact.part === part) ??
      previousFacts.find((fact) => key(fact.object) === key(object) && fact.part === "whole");
    carried.set(key([object, part]), {
      object,
      part,
      readAt: earlier?.readAt ?? parentReadAt ?? previous.extractedAt,
    });
  };
  for (const old of entries(saved)) {
    const current = entries(code).find((entry) => key(entry.object) === key(old.object));
    if (current !== undefined) {
      if (
        !textsOff &&
        old.definition?.status === "readable" &&
        (current.definition?.status === "notVisible" ||
          (code.capture.definitions.status !== "read" &&
            current.definition?.status === "notRecorded"))
      ) {
        setDefinition(current, old.definition);
        record(old.object, "definition");
      }
      continue;
    }
    const parent =
      old.object.kind === "trigger"
        ? old.object.parent
        : old.object.kind === "view"
          ? old.object.name
          : null;
    const parentFact =
      parent === null
        ? undefined
        : merged.carriedOver?.find(
            (fact) =>
              sameName(fact.object, parent) &&
              (fact.fact.kind === "table" || fact.fact.kind === "view"),
          );
    const held =
      parent !== null &&
      [...merged.tables, ...merged.views].some((value) => sameName(value.name, parent));
    const inScope =
      old.object.kind !== "routine" ||
      merged.access === undefined ||
      merged.access.scope.schemas.length === 0 ||
      merged.access.scope.schemas.includes(old.object.name.schema);
    const keep =
      old.object.kind === "routine"
        ? inScope && (code.capture.objects.status !== "read" || !vouches(merged, old.object))
        : held && (code.capture.objects.status !== "read" || parentFact !== undefined);
    if (!keep) continue;
    const copy = structuredClone(old.value);
    if (old.object.kind === "routine") code.routines.push(copy as Routine);
    if (old.object.kind === "trigger") code.triggers.push(copy as Trigger);
    if (old.object.kind === "view") code.views.push(copy as ViewModule);
    record(old.object, "whole", parentFact?.readAt);
    if (
      !textsOff &&
      previousFacts.some(
        (fact) => key(fact.object) === key(old.object) && fact.part === "definition",
      )
    )
      record(old.object, "definition");
  }
  if (textsOff)
    for (const entry of entries(code))
      if (entry.definition !== null) setDefinition(entry, { status: "notRecorded" });
  code.carriedOver = [...carried.values()]
    .filter((fact) => !textsOff || fact.part !== "definition")
    .sort(
      (left, right) =>
        key(left.object).localeCompare(key(right.object)) || left.part.localeCompare(right.part),
    );
  code.routines.sort((left, right) => key(left.name).localeCompare(key(right.name)));
  return { ...merged, programmability: code };
}

export function codeCaptureChanges(
  previous: SchemaSnapshot,
  current: SchemaSnapshot,
): CaptureChange[] {
  const before = previous.programmability;
  const after = current.programmability;
  if (after === undefined) return [];
  const changes: CaptureChange[] = [];
  if (!recordsObjects(before) && after.capture.objects.status === "read")
    changes.push({ kind: "programmabilityRecorded", counts: codeCounts(after) });
  if (before !== undefined && recordsObjects(before) && isOff(after.capture.objects))
    changes.push({ kind: "programmabilityNoLongerRecorded", counts: codeCounts(before) });
  if (!recordsTexts(before) && after.capture.definitions.status === "read")
    changes.push({
      kind: "moduleDefinitionsRecorded",
      count: moduleDefinitions(after).filter((definition) => definition.status === "readable")
        .length,
    });
  if (
    before !== undefined &&
    recordsTexts(before) &&
    (isOff(after.capture.objects) || isOff(after.capture.definitions))
  )
    changes.push({
      kind: "moduleDefinitionsNoLongerRecorded",
      count: moduleDefinitions(before).filter((definition) => definition.status === "readable")
        .length,
    });
  return changes;
}

const normalised = (text: string) =>
  text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/gu, ""))
    .join("\n")
    .replace(/^\n+|\n+$/gu, "");
/** Preview edits are intentionally limited to definition and encryption changes. */
export function codeDiff(previous: SchemaSnapshot, merged: SchemaSnapshot): CodeDiff {
  const before = previous.programmability;
  const after = merged.programmability;
  const changes: CodeChange[] = [];
  const nowAvailable: AvailableCode[] = [];
  const notChecked = after?.carriedOver ?? [];
  const readFailures: CodeDiff["readFailures"] = (["objects", "definitions"] as const).flatMap(
    (family) => {
      const state = after?.capture[family];
      return state?.status === "notRead" &&
        (state.reason === "queryFailed" || state.reason === "timedOut")
        ? [{ family, reason: state.reason }]
        : [];
    },
  );
  if (
    before === undefined ||
    after === undefined ||
    !recordsObjects(before) ||
    !recordsObjects(after)
  )
    return { changes, nowAvailable, notChecked, readFailures };
  const left = entries(before);
  const right = entries(after);
  for (const current of right) {
    const old = left.find((entry) => key(entry.object) === key(current.object));
    if (old === undefined) {
      if (current.object.kind === "view") continue;
      if (vouches(previous, current.object))
        changes.push({ kind: "added", object: current.object, routineKind: current.routineKind });
      else nowAvailable.push({ object: current.object, part: "whole" });
    } else if (
      (old.definition?.status === "readable" && current.definition?.status === "encrypted") ||
      (old.definition?.status === "encrypted" && current.definition?.status === "readable")
    )
      changes.push({
        kind: "changed",
        object: current.object,
        routineKind: current.routineKind,
        properties: ["encryption"],
      });
    else if (
      old.definition?.status === "readable" &&
      current.definition?.status === "readable" &&
      normalised(old.definition.text) !== normalised(current.definition.text)
    )
      changes.push({
        kind: "changed",
        object: current.object,
        routineKind: current.routineKind,
        properties: ["definition"],
      });
    else if (
      recordsTexts(before) &&
      old.definition?.status !== "readable" &&
      old.definition?.status !== "encrypted" &&
      current.definition?.status === "readable"
    )
      nowAvailable.push({ object: current.object, part: "definition" });
  }
  for (const old of left)
    if (old.object.kind !== "view" && !right.some((entry) => key(entry.object) === key(old.object)))
      changes.push({ kind: "removed", object: old.object, routineKind: old.routineKind });
  return { changes, nowAvailable, notChecked, readFailures };
}
