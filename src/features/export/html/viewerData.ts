import { describeEntities } from "@/features/canvas/geometry";
import { visibleEntityKeys } from "@/features/canvas/graph";
import { accessSummary } from "@/features/schema/coverage";
import type { AccessSummary } from "@/features/schema/coverage";
import { withoutText } from "@/features/schema/definition";
import { entityKey } from "@/features/schema/entities";
import type {
  CanvasState,
  CaptureState,
  CarriedFact,
  DetailLevel,
  Definition,
  ModuleBody,
  PostgresqlMetadata,
  QualifiedName,
  Programmability,
  SchemaSnapshot,
} from "@/shared/contracts";
import type { Locale } from "@/shared/i18n/locales";

import type { ExportTheme } from "../svg/palette";
import type { ViewerMessages } from "./viewerMessages";

/** Everything the standalone viewer embeds: the visible part of the schema and how to show it. */
export interface ViewerData {
  /** Name and version of the application that wrote the file. */
  generator: string;
  /** Moment of the export, ISO 8601. */
  exportedAt: string;
  locale: Locale;
  theme: ExportTheme;
  detailLevel: DetailLevel;
  snapshot: SchemaSnapshot;
  canvas: CanvasState;
  /**
   * The verdicts on what the reading login could see, never the probe behind them; `null` when
   * the capture did not record them. The detail panel needs the coverage to say whether an
   * empty list is a fact.
   */
  access: AccessSummary | null;
  /** Facts of the exported objects kept from an earlier read, each with the moment it was last read. */
  carriedOver: CarriedFact[];
  /** The application's words the viewer says, in the language of the export. */
  messages: ViewerMessages;
  /** Only reviewed projected note text; no global note map or stable note identities. */
  noteLines?: string[];
}

/** Id of the `<script type="application/json">` element that carries the data. */
export const VIEWER_DATA_ELEMENT_ID = "schemacraft-data";
/** Id of the element the viewer renders into. */
export const VIEWER_ROOT_ELEMENT_ID = "schemacraft-viewer";

/**
 * Whether an exported diagram must say that the schema was read with partial access. It leaves
 * the application without the status bar and the access report, and a table the login could not
 * see would otherwise look like a table that does not exist.
 */
export function carriesAccessNote(access: Pick<AccessSummary, "level"> | null): boolean {
  return access?.level === "partial";
}

/** Identity of a foreign key: the key of its referencing table and its name. */
function exportedKeyId(referencingKey: string, name: string): string {
  return JSON.stringify([referencingKey, name]);
}

/** Capture states are rebuilt too: a newer file's extra fields may contain code. */
function captureWithoutExtensions(capture: CaptureState): CaptureState {
  switch (capture.status) {
    case "read":
      return { status: "read" };
    case "notRead":
      return { status: "notRead", reason: capture.reason };
    case "unknown":
    default:
      return { status: "unknown" };
  }
}

/** A module's implementation and missing-text state, never its body or unknown extensions. */
function bodyWithoutText(body: ModuleBody): ModuleBody {
  switch (body.language) {
    case "postgreSql":
      return { language: "postgreSql", name: body.name, definition: withoutText(body.definition) };
    case "sql":
      return { language: "sql", definition: withoutText(body.definition) };
    case "clr":
      return { language: "clr" };
    case "unknown":
    default:
      return { language: "unknown" };
  }
}

/** Only the metadata needed for the visible entities; routines and the code ledger stay behind. */
function visibleProgrammability(
  snapshot: SchemaSnapshot,
  programmability: Programmability,
  visible: ReadonlySet<string>,
): Programmability {
  const keptParents = new Set(
    (snapshot.carriedOver ?? [])
      .filter((item) => item.fact.kind === "table" || item.fact.kind === "view")
      .map((item) => entityKey(item.object)),
  );
  // Normally a whole kept trigger or view belongs to a whole kept parent. If a file has no
  // parent date for it, the export cannot carry the code ledger to explain that stale list.
  // Downgrading the capture avoids presenting the remaining list as complete.
  const hasUndatedWholeModule = (programmability.carriedOver ?? []).some((item) => {
    if (item.part !== "whole") {
      return false;
    }
    const parent =
      item.object.kind === "trigger"
        ? item.object.parent
        : item.object.kind === "view"
          ? item.object.name
          : null;
    return parent !== null && visible.has(entityKey(parent)) && !keptParents.has(entityKey(parent));
  });
  const objects: CaptureState =
    programmability.capture.objects.status === "read" && hasUndatedWholeModule
      ? { status: "unknown" }
      : captureWithoutExtensions(programmability.capture.objects);
  const metadataIsCurrent = (key: string) =>
    objects.status === "read" && visible.has(key) && !keptParents.has(key);
  const visibleViews = new Set(snapshot.views.map((view) => entityKey(view.name)));
  return {
    capture: {
      objects,
      definitions: captureWithoutExtensions(programmability.capture.definitions),
    },
    views: programmability.views
      .filter(
        (module) =>
          visibleViews.has(entityKey(module.view)) && metadataIsCurrent(entityKey(module.view)),
      )
      .map((module) => ({
        view: { schema: module.view.schema, name: module.view.name },
        definition: withoutText(module.definition),
        hasCheckOption: module.hasCheckOption,
        isIndexed: module.isIndexed,
      })),
    routines: [],
    triggers: programmability.triggers
      .filter((trigger) => metadataIsCurrent(entityKey(trigger.parent)))
      .map((trigger) => ({
        parent: { schema: trigger.parent.schema, name: trigger.parent.name },
        name: trigger.name,
        timing: trigger.timing,
        events: trigger.events.map((event) => ({ event: event.event, order: event.order })),
        isEnabled: trigger.isEnabled,
        isNotForReplication: trigger.isNotForReplication,
        body: bodyWithoutText(trigger.body),
      })),
  };
}

/** Explicit native allowlist: no routine source, access evidence, dependencies or extensions. */
function visiblePostgresql(
  native: PostgresqlMetadata,
  visible: ReadonlySet<string>,
  keys: ReadonlySet<string>,
  code: Programmability | undefined,
): PostgresqlMetadata {
  const name = (value: QualifiedName): QualifiedName => ({
    schema: value.schema,
    name: value.name,
  });
  const definition = (value: Definition): Definition => {
    switch (value.status) {
      case "readable":
        return { status: "readable", text: value.text };
      case "encrypted":
        return { status: "encrypted" };
      case "notVisible":
        return { status: "notVisible" };
      case "notRecorded":
        return { status: "notRecorded" };
      case "unknown":
      default:
        return { status: "unknown" };
    }
  };
  return {
    tables: native.tables
      .filter((item) => visible.has(entityKey(item.name)))
      .map((item) => ({ name: name(item.name), kind: item.kind })),
    columns: native.columns
      .filter((item) => visible.has(entityKey(item.object)))
      .map((item) => ({
        object: name(item.object),
        name: item.name,
        typeName: name(item.typeName),
        typeKind: item.typeKind,
        identityGeneration: item.identityGeneration,
        generation: item.generation,
        generationExpression:
          item.generationExpression === null ? null : definition(item.generationExpression),
      })),
    views: native.views
      .filter((item) => visible.has(entityKey(item.name)))
      .map((item) => ({
        name: name(item.name),
        isMaterialized: item.isMaterialized,
        isPopulated: item.isPopulated,
        checkOption: item.checkOption,
      })),
    indexes: native.indexes
      .filter((item) => visible.has(entityKey(item.table)))
      .map((item) => ({
        table: name(item.table),
        name: name(item.name),
        method: item.method,
        definition: definition(item.definition),
        keyTerms: [...item.keyTerms],
        keyColumns: [...item.keyColumns],
        includedColumns: [...item.includedColumns],
        predicate: item.predicate === null ? null : definition(item.predicate),
        isUnique: item.isUnique,
        isValid: item.isValid,
        isReady: item.isReady,
        isLive: item.isLive,
        nullsNotDistinct: item.nullsNotDistinct,
        wasClustered: item.wasClustered,
        constraint: item.constraint,
      })),
    constraints: native.constraints
      .filter(
        (item) =>
          visible.has(entityKey(item.table)) &&
          (item.kind !== "foreignKey" || keys.has(exportedKeyId(entityKey(item.table), item.name))),
      )
      .map((item) => ({
        table: name(item.table),
        name: item.name,
        kind: item.kind,
        definition: definition(item.definition),
        isValidated: item.isValidated,
        isEnforced: item.isEnforced,
        isDeferrable: item.isDeferrable,
        isInitiallyDeferred: item.isInitiallyDeferred,
        matchType: item.matchType,
        deleteSetColumns: [...item.deleteSetColumns],
      })),
    routines: [],
    triggers: native.triggers.flatMap((item) => {
      const ref = item.object;
      if (
        ref.kind !== "trigger" ||
        !code?.triggers.some(
          (trigger) =>
            entityKey(trigger.parent) === entityKey(ref.parent) && trigger.name === ref.name,
        )
      )
        return [];
      return [
        {
          object: { kind: "trigger" as const, parent: name(ref.parent), name: ref.name },
          function: null,
          level: item.level,
          enabledMode: item.enabledMode,
          isConstraint: item.isConstraint,
          isDeferrable: item.isDeferrable,
          isInitiallyDeferred: item.isInitiallyDeferred,
          updateColumns: [...item.updateColumns],
        },
      ];
    }),
  };
}

/**
 * What of a project may leave the application in an export. The schema and the canvas are
 * restricted to what is visible, so hidden tables never leave it, and both are rebuilt from the
 * fields this version knows, so neither the access probe nor keys written by a newer version are
 * embedded. The facts kept from earlier reads (`carriedOver`) travel apart from the snapshot and
 * only for the objects and keys on the diagram, so the detail panel can date them without naming
 * a hidden table. The server version and the viewport are dropped as well: the file carries the database
 * name, the objects on the diagram, their positions, the access verdicts and those dates. Tables,
 * views and keys need no allowlist of their own, because the project reader keeps unknown keys
 * only at the levels rebuilt here. Programmability is rebuilt field by field: only visible
 * parents' trigger metadata and visible views' settings travel, with every module text removed.
 */
export function visibleProjection(
  snapshot: SchemaSnapshot,
  canvas: CanvasState,
): Pick<ViewerData, "snapshot" | "canvas" | "access" | "carriedOver"> {
  const visible = visibleEntityKeys(describeEntities(snapshot), canvas.nodes);
  // Their columns keep the key badge on the diagram, so the viewer must know them too.
  const keysToInvisibleTables = (snapshot.foreignKeysToInvisibleTables ?? []).filter((key) =>
    visible.has(entityKey(key.referencingTable)),
  );
  const foreignKeys = snapshot.foreignKeys.filter(
    (key) =>
      visible.has(entityKey(key.referencingTable)) && visible.has(entityKey(key.referencedTable)),
  );
  // A kept key is recorded on its referencing table, which may be on the diagram while the
  // table it references is not; its name then often spells out that table.
  const exportedKeys = new Set(
    [...foreignKeys, ...keysToInvisibleTables].map((key) =>
      exportedKeyId(entityKey(key.referencingTable), key.name),
    ),
  );
  const code =
    snapshot.programmability === undefined
      ? undefined
      : visibleProgrammability(snapshot, snapshot.programmability, visible);
  return {
    snapshot: {
      ...(snapshot.provider === undefined ? {} : { provider: snapshot.provider }),
      ...(snapshot.postgresql === undefined
        ? {}
        : { postgresql: visiblePostgresql(snapshot.postgresql, visible, exportedKeys, code) }),
      databaseName: snapshot.databaseName,
      serverVersion: null,
      extractedAt: snapshot.extractedAt,
      tables: snapshot.tables.filter((table) => visible.has(entityKey(table.name))),
      views: snapshot.views.filter((view) => visible.has(entityKey(view.name))),
      foreignKeys,
      ...(code === undefined ? {} : { programmability: code }),
      ...(keysToInvisibleTables.length > 0
        ? { foreignKeysToInvisibleTables: keysToInvisibleTables }
        : {}),
    },
    canvas: {
      detailLevel: canvas.detailLevel,
      layout: canvas.layout,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: canvas.nodes
        .filter((node) => visible.has(entityKey(node.name)))
        .map((node) => ({
          name: node.name,
          position: node.position,
          isCollapsed: node.isCollapsed,
          isHidden: node.isHidden,
        })),
    },
    access: accessSummary(snapshot),
    // Visible tables and views travel whole, so only a key fact needs its key on the diagram too.
    carriedOver: (snapshot.carriedOver ?? [])
      .filter(
        (carried) =>
          visible.has(entityKey(carried.object)) &&
          (carried.fact.kind !== "foreignKey" ||
            exportedKeys.has(exportedKeyId(entityKey(carried.object), carried.fact.name))),
      )
      .map((carried) => ({
        object: { schema: carried.object.schema, name: carried.object.name },
        fact: carried.fact,
        readAt: carried.readAt,
      })),
  };
}
