/**
 * What a login can see, simulated for the browser preview: the verdicts of
 * `AccessProfile::predicted` and `AccessProfile::observed`, and the merge a refresh applies
 * (`SchemaSnapshot::with_unchecked_facts_from`) together with what a review reports about it.
 * They follow the Rust rules closely enough to design the access notices and the review against;
 * the Rust tests remain the reference. Loaded only with the preview backends.
 */
import type {
  AccessCounts,
  AccessProbe,
  AccessProfile,
  AvailableFact,
  CaptureChange,
  CaptureScope,
  CarriedFact,
  Completeness,
  Definition,
  ForeignKey,
  ForeignKeyToInvisibleTable,
  Index,
  QualifiedName,
  SchemaSnapshot,
  SnapshotFact,
  Table,
} from "@/shared/contracts";

/** Every schema, views included: the scope of a prediction made before anything is read. */
const WHOLE_DATABASE: CaptureScope = { schemas: [], includeViews: true };

const NOTHING_FOUND: AccessCounts = {
  definitions: 0,
  definitionsNotVisible: 0,
  foreignKeysToInvisibleTables: 0,
};

/** Map key of a qualified name; JSON keeps names with dots apart. */
export function nameKey(name: QualifiedName): string {
  return JSON.stringify([name.schema, name.name]);
}

/** Map key of a foreign key: its referencing table and its name. */
export function keyIdentity(key: ForeignKey | ForeignKeyToInvisibleTable): string {
  return JSON.stringify([key.referencingTable.schema, key.referencingTable.name, key.name]);
}

/** Ordinal comparison, the order Rust gives strings. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Orders qualified names by schema, then name, as the inspectors list objects. */
export function compareNames(left: QualifiedName, right: QualifiedName): number {
  return compareText(left.schema, right.schema) || compareText(left.name, right.name);
}

/** Orders foreign keys by referencing table, then name, as the inspectors list them. */
export function compareKeys(
  left: ForeignKey | ForeignKeyToInvisibleTable,
  right: ForeignKey | ForeignKeyToInvisibleTable,
): number {
  return (
    compareNames(left.referencingTable, right.referencingTable) ||
    compareText(left.name, right.name)
  );
}

function includesSchema(scope: CaptureScope, schema: string): boolean {
  return scope.schemas.length === 0 || scope.schemas.includes(schema);
}

/** Whether a capture by this login would list every table and view of `schema`. */
function listsEveryObjectIn(probe: AccessProbe, schema: string): boolean {
  if (probe.explicitDenials !== 0) {
    return false;
  }
  const access = probe.schemas.find((candidate) => candidate.name === schema);
  return access === undefined
    ? probe.canReadDefinitions || probe.canReadData
    : (access.canReadDefinitions || access.canReadData) && !access.isDenied;
}

function objectsCoverage(
  probe: AccessProbe,
  scope: CaptureScope,
  counts: AccessCounts,
): Completeness {
  const schemas =
    scope.schemas.length === 0 ? probe.schemas.map((access) => access.name) : scope.schemas;
  return probe.explicitDenials === 0 &&
    counts.foreignKeysToInvisibleTables === 0 &&
    schemas.every((schema) => listsEveryObjectIn(probe, schema))
    ? "complete"
    : "partial";
}

function predictedDefinitions(probe: AccessProbe): Completeness {
  const readable = probe.schemas
    .filter((access) => access.hasVisibleObjects)
    .map((access) => access.canReadDefinitions);
  if (readable.length === 0) {
    return probe.canReadDefinitions ? "complete" : "notAvailable";
  }
  if (readable.every(Boolean)) {
    return "complete";
  }
  return readable.some(Boolean) ? "partial" : "notAvailable";
}

function observedDefinitions(counts: AccessCounts): Completeness {
  if (counts.definitionsNotVisible === 0) {
    return "complete";
  }
  return counts.definitionsNotVisible >= counts.definitions ? "notAvailable" : "partial";
}

function judged(
  probe: AccessProbe,
  scope: CaptureScope,
  counts: AccessCounts,
  definitions: Completeness,
): AccessProfile {
  if (probe.seesObjects) {
    const coverage = { objects: objectsCoverage(probe, scope, counts), definitions };
    const isFull = coverage.objects === "complete" && coverage.definitions === "complete";
    return { probe, scope, level: isFull ? "full" : "partial", coverage, counts };
  }
  if (probe.canReadDefinitions && probe.explicitDenials === 0) {
    const coverage = { objects: "complete", definitions: "complete" } as const;
    return { probe, scope, level: "empty", coverage, counts };
  }
  const coverage = { objects: "notAvailable", definitions: "notAvailable" } as const;
  return { probe, scope, level: "nothingVisible", coverage, counts };
}

/** What a capture of the whole database is predicted to see, before anything is read. */
export function predictedAccess(probe: AccessProbe): AccessProfile {
  return judged(probe, WHOLE_DATABASE, NOTHING_FOUND, predictedDefinitions(probe));
}

/** What the capture `snapshot` of `scope` could see. */
export function observedAccess(
  probe: AccessProbe,
  scope: CaptureScope,
  snapshot: Pick<SchemaSnapshot, "tables" | "views" | "foreignKeysToInvisibleTables">,
): AccessProfile {
  const definitions: Definition[] = [
    ...snapshot.tables.flatMap((table) => [
      ...table.columns.flatMap((column) => column.defaultExpression ?? []),
      ...table.checkConstraints.map((constraint) => constraint.expression),
    ]),
    ...snapshot.views.flatMap((view) =>
      view.columns.flatMap((column) => column.defaultExpression ?? []),
    ),
  ];
  const counts: AccessCounts = {
    definitions: definitions.length,
    definitionsNotVisible: definitions.filter((definition) => definition.status === "notVisible")
      .length,
    foreignKeysToInvisibleTables: snapshot.foreignKeysToInvisibleTables?.length ?? 0,
  };
  return judged(probe, scope, counts, observedDefinitions(counts));
}

const FACT_ORDER: Record<SnapshotFact["kind"], number> = {
  table: 0,
  view: 1,
  columnDefault: 2,
  checkConstraint: 3,
  foreignKey: 4,
};

function factDetail(fact: SnapshotFact): string {
  switch (fact.kind) {
    case "table":
    case "view":
      return "";
    case "columnDefault":
      return fact.column;
    case "checkConstraint":
    case "foreignKey":
      return fact.name;
  }
}

function factKey(object: QualifiedName, fact: SnapshotFact): string {
  return JSON.stringify([object.schema, object.name, fact.kind, factDetail(fact)]);
}

/** Orders facts by object, then by kind and name, as the Rust side lists them. */
function compareFacts(
  left: { object: QualifiedName; fact: SnapshotFact },
  right: { object: QualifiedName; fact: SnapshotFact },
): number {
  return (
    compareNames(left.object, right.object) ||
    FACT_ORDER[left.fact.kind] - FACT_ORDER[right.fact.kind] ||
    compareText(factDetail(left.fact), factDetail(right.fact))
  );
}

function sameKey(left: ForeignKey | ForeignKeyToInvisibleTable) {
  return (right: ForeignKey | ForeignKeyToInvisibleTable) =>
    keyIdentity(left) === keyIdentity(right);
}

/**
 * `current` merged with the saved facts it could not check, each listed in `carriedOver` with
 * the moment it was last read: saved tables and views missing from a schema the capture cannot
 * vouch for, saved texts that are now not visible, the saved foreign keys of kept tables and
 * the saved keys whose referenced table became invisible.
 */
export function withUncheckedFacts(
  current: SchemaSnapshot,
  previous: SchemaSnapshot,
): SchemaSnapshot {
  const earlierReads = new Map(
    (previous.carriedOver ?? []).map((carried) => [
      factKey(carried.object, carried.fact),
      carried.readAt,
    ]),
  );
  const ledger = new Map<string, CarriedFact>(
    (current.carriedOver ?? []).map((carried) => [factKey(carried.object, carried.fact), carried]),
  );
  let hasNewFacts = false;
  const record = (object: QualifiedName, fact: SnapshotFact) => {
    const key = factKey(object, fact);
    if (!ledger.has(key)) {
      ledger.set(key, { object, fact, readAt: earlierReads.get(key) ?? previous.extractedAt });
    }
    hasNewFacts = true;
  };

  const savedTables = new Map(previous.tables.map((table) => [nameKey(table.name), table]));
  const withSavedTexts = (table: Table): Table => {
    const saved = savedTables.get(nameKey(table.name));
    if (saved === undefined) {
      return table;
    }
    return {
      ...table,
      columns: table.columns.map((column) => {
        const text = saved.columns.find(
          (candidate) => candidate.name === column.name,
        )?.defaultExpression;
        if (column.defaultExpression?.status !== "notVisible" || text?.status !== "readable") {
          return column;
        }
        record(table.name, { kind: "columnDefault", column: column.name });
        return { ...column, defaultExpression: text };
      }),
      checkConstraints: table.checkConstraints.map((constraint) => {
        const text = saved.checkConstraints.find(
          (candidate) => candidate.name === constraint.name,
        )?.expression;
        if (constraint.expression.status !== "notVisible" || text?.status !== "readable") {
          return constraint;
        }
        record(table.name, { kind: "checkConstraint", name: constraint.name });
        return { ...constraint, expression: text };
      }),
    };
  };

  const scope = current.access?.scope;
  const probe = current.access?.probe;
  const mayHide = (name: QualifiedName, isView: boolean) =>
    scope !== undefined &&
    probe !== undefined &&
    includesSchema(scope, name.schema) &&
    (scope.includeViews || !isView) &&
    !listsEveryObjectIn(probe, name.schema);

  const tables = current.tables.map(withSavedTexts);
  const presentTables = new Set(tables.map((table) => nameKey(table.name)));
  const keptTables = previous.tables.filter(
    (table) => !presentTables.has(nameKey(table.name)) && mayHide(table.name, false),
  );
  for (const table of keptTables) {
    record(table.name, { kind: "table" });
    for (const carried of previous.carriedOver ?? []) {
      const isText =
        carried.fact.kind === "columnDefault" || carried.fact.kind === "checkConstraint";
      if (isText && nameKey(carried.object) === nameKey(table.name)) {
        record(carried.object, carried.fact);
      }
    }
  }

  const presentViews = new Set(current.views.map((view) => nameKey(view.name)));
  const keptViews = previous.views.filter(
    (view) => !presentViews.has(nameKey(view.name)) && mayHide(view.name, true),
  );
  for (const view of keptViews) {
    record(view.name, { kind: "view" });
  }

  const mergedTables = new Set([
    ...presentTables,
    ...keptTables.map((table) => nameKey(table.name)),
  ]);
  const keptTableNames = new Set(keptTables.map((table) => nameKey(table.name)));
  const foreignKeys = [...current.foreignKeys];
  let invisible = [...(current.foreignKeysToInvisibleTables ?? [])];
  for (const key of previous.foreignKeys) {
    if (foreignKeys.some(sameKey(key)) || !mergedTables.has(nameKey(key.referencedTable))) {
      continue;
    }
    if (invisible.some(sameKey(key))) {
      invisible = invisible.filter((candidate) => !sameKey(key)(candidate));
    } else if (!keptTableNames.has(nameKey(key.referencingTable))) {
      continue;
    }
    record(key.referencingTable, { kind: "foreignKey", name: key.name });
    foreignKeys.push(key);
  }
  for (const key of previous.foreignKeysToInvisibleTables ?? []) {
    if (!keptTableNames.has(nameKey(key.referencingTable)) || invisible.some(sameKey(key))) {
      continue;
    }
    record(key.referencingTable, { kind: "foreignKey", name: key.name });
    invisible.push(key);
  }

  const sortIfKept = <Item>(items: Item[], compare: (left: Item, right: Item) => number) =>
    hasNewFacts ? items.toSorted(compare) : items;
  const carriedOver = [...ledger.values()].toSorted(compareFacts);
  const merged: SchemaSnapshot = {
    ...current,
    tables: sortIfKept([...tables, ...keptTables], (left, right) =>
      compareNames(left.name, right.name),
    ),
    views: sortIfKept([...current.views, ...keptViews], (left, right) =>
      compareNames(left.name, right.name),
    ),
    foreignKeys: sortIfKept(foreignKeys, compareKeys),
  };
  delete merged.foreignKeysToInvisibleTables;
  delete merged.carriedOver;
  return {
    ...merged,
    ...(invisible.length > 0
      ? { foreignKeysToInvisibleTables: sortIfKept(invisible, compareKeys) }
      : {}),
    ...(carriedOver.length > 0 ? { carriedOver } : {}),
  };
}

/** Keys `previous` listed as pointing to an invisible table that `merged` draws as edges. */
export function keysWhoseTargetBecameVisible(
  previous: SchemaSnapshot,
  merged: SchemaSnapshot,
): Set<string> {
  return new Set(
    (previous.foreignKeysToInvisibleTables ?? [])
      .filter((invisible) =>
        merged.foreignKeys.some(
          (key) =>
            keyIdentity(key) === keyIdentity(invisible) &&
            key.columnPairs.map((pair) => pair.referencingColumn).join("\u0000") ===
              invisible.columns.join("\u0000") &&
            key.onDelete === invisible.onDelete &&
            key.onUpdate === invisible.onUpdate &&
            key.isEnabled === invisible.isEnabled &&
            !recordedStateDiffers(key.isTrusted, invisible.isTrusted),
        ),
      )
      .map(keyIdentity),
  );
}

/** Whether both sides recorded a state and it differs; one recorded on one side is no change. */
function recordedStateDiffers<T>(before: T | undefined, after: T | undefined): boolean {
  return before !== undefined && after !== undefined && before !== after;
}

/** Whether a capture recorded the state of `index`, as every 1.2 capture does. */
function indexStateRecorded(index: Index): boolean {
  return (
    index.isEnabled !== undefined ||
    index.isFiltered !== undefined ||
    index.includedColumns !== undefined
  );
}

function newlyRecordedInTable(previous: Table, current: Table): number {
  const newly = (before: boolean, after: boolean) => (!before && after ? 1 : 0);
  const primaryKey =
    previous.primaryKey !== null && current.primaryKey !== null
      ? newly(
          previous.primaryKey.isEnabled !== undefined,
          current.primaryKey.isEnabled !== undefined,
        )
      : 0;
  const indexes = current.indexes.reduce((total, index) => {
    const saved = previous.indexes.find((candidate) => candidate.name === index.name);
    return (
      total +
      (saved === undefined ? 0 : newly(indexStateRecorded(saved), indexStateRecorded(index)))
    );
  }, 0);
  const checks = current.checkConstraints.reduce((total, constraint) => {
    const saved = previous.checkConstraints.find((candidate) => candidate.name === constraint.name);
    return (
      total +
      (saved === undefined
        ? 0
        : newly(saved.isTrusted !== undefined, constraint.isTrusted !== undefined))
    );
  }, 0);
  return primaryKey + indexes + checks;
}

/**
 * The families of facts `merged` records for objects `previous` holds without them, as Rust
 * `capture_changes` reports them: the state of indexes, keys and constraints next to a project
 * saved before 1.2.
 */
export function captureChanges(previous: SchemaSnapshot, merged: SchemaSnapshot): CaptureChange[] {
  const savedTables = new Map(previous.tables.map((table) => [nameKey(table.name), table]));
  const inTables = merged.tables.reduce((total, table) => {
    const saved = savedTables.get(nameKey(table.name));
    return total + (saved === undefined ? 0 : newlyRecordedInTable(saved, table));
  }, 0);
  const keys = (snapshot: SchemaSnapshot) => [
    ...snapshot.foreignKeys,
    ...(snapshot.foreignKeysToInvisibleTables ?? []),
  ];
  const savedTrust = new Map(keys(previous).map((key) => [keyIdentity(key), key.isTrusted]));
  const inKeys = keys(merged).filter(
    (key) =>
      savedTrust.has(keyIdentity(key)) &&
      savedTrust.get(keyIdentity(key)) === undefined &&
      key.isTrusted !== undefined,
  ).length;
  const count = inTables + inKeys;
  return count === 0 ? [] : [{ kind: "indexAndConstraintStateRecorded", count }];
}

function becameReadable(before: Definition | null | undefined, after: Definition | null) {
  return (
    before !== undefined &&
    before !== null &&
    before.status !== "readable" &&
    after?.status === "readable"
  );
}

/** Facts `previous` could not state that `merged` reads: texts now readable, keys now drawn. */
export function factsNowAvailable(
  previous: SchemaSnapshot,
  merged: SchemaSnapshot,
): AvailableFact[] {
  const savedTables = new Map(previous.tables.map((table) => [nameKey(table.name), table]));
  const texts = merged.tables.flatMap((table): AvailableFact[] => {
    const saved = savedTables.get(nameKey(table.name));
    if (saved === undefined) {
      return [];
    }
    const defaults = table.columns
      .filter((column) =>
        becameReadable(
          saved.columns.find((candidate) => candidate.name === column.name)?.defaultExpression,
          column.defaultExpression,
        ),
      )
      .map((column) => ({
        object: table.name,
        fact: { kind: "columnDefault" as const, column: column.name },
      }));
    const checks = table.checkConstraints
      .filter((constraint) =>
        becameReadable(
          saved.checkConstraints.find((candidate) => candidate.name === constraint.name)
            ?.expression,
          constraint.expression,
        ),
      )
      .map((constraint) => ({
        object: table.name,
        fact: { kind: "checkConstraint" as const, name: constraint.name },
      }));
    return [...defaults, ...checks];
  });
  const visibleTargets = keysWhoseTargetBecameVisible(previous, merged);
  const keys = (previous.foreignKeysToInvisibleTables ?? [])
    .filter((key) => visibleTargets.has(keyIdentity(key)))
    .map((key) => ({
      object: key.referencingTable,
      fact: { kind: "foreignKey" as const, name: key.name },
    }));
  return [...texts, ...keys].toSorted(compareFacts);
}

/** Whether the two captures reached another verdict on what their login sees. */
export function accessChanged(previous: SchemaSnapshot, current: SchemaSnapshot): boolean {
  const verdict = (snapshot: SchemaSnapshot) =>
    snapshot.access === undefined
      ? "none"
      : `${snapshot.access.level}/${snapshot.access.coverage.objects}/${snapshot.access.coverage.definitions}`;
  return verdict(previous) !== verdict(current);
}
