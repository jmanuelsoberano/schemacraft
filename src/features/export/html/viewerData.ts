import { describeEntities, entityKey } from "@/features/canvas/geometry";
import { visibleEntityKeys } from "@/features/canvas/graph";
import type { AccessSummary } from "@/features/schema/coverage";
import type { CanvasState, DetailLevel, SchemaSnapshot } from "@/shared/contracts";
import type { Locale } from "@/shared/i18n/locales";

import type { ExportTheme } from "../svg/palette";

/**
 * What an export may say about the access of the login that read the schema: the verdict only.
 * The probe never leaves the application, since it names schemas, permissions and the user.
 */
export type ExportedAccess = Pick<AccessSummary, "level">;

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
  /** Verdict on what the reading login could see; `null` when the capture did not record it. */
  access: ExportedAccess | null;
}

/** Id of the `<script type="application/json">` element that carries the data. */
export const VIEWER_DATA_ELEMENT_ID = "schemacraft-data";
/** Id of the element the viewer renders into. */
export const VIEWER_ROOT_ELEMENT_ID = "schemacraft-viewer";

/** The access verdict of a capture as an export may carry it. */
export function exportedAccess(snapshot: SchemaSnapshot): ExportedAccess | null {
  return snapshot.access === undefined ? null : { level: snapshot.access.level };
}

/**
 * Whether an exported diagram must say that the schema was read with partial access. It leaves
 * the application without the status bar and the access report, and a table the login could not
 * see would otherwise look like a table that does not exist.
 */
export function carriesAccessNote(access: ExportedAccess | null): boolean {
  return access?.level === "partial";
}

/**
 * What of a project may leave the application in an export. The schema and the canvas are
 * restricted to what is visible, so hidden tables never leave it, and both are rebuilt from the
 * fields this version knows, so neither the access probe, the list of facts kept from earlier
 * reads (`carriedOver`) nor keys written by a newer version are embedded. The kept facts
 * themselves, tables, texts and keys an earlier read saw, stay on the diagram like any other
 * object and are exported with it. The server version and the viewport are dropped as well: the
 * file carries the database name, the objects on the diagram, their positions and the access
 * verdict. Tables, views and keys need no allowlist of their own, because the project reader
 * keeps unknown keys only at the levels rebuilt here.
 */
export function visibleProjection(
  snapshot: SchemaSnapshot,
  canvas: CanvasState,
): Pick<ViewerData, "snapshot" | "canvas" | "access"> {
  const visible = visibleEntityKeys(describeEntities(snapshot), canvas.nodes);
  // Their columns keep the key badge on the diagram, so the viewer must know them too.
  const keysToInvisibleTables = (snapshot.foreignKeysToInvisibleTables ?? []).filter((key) =>
    visible.has(entityKey(key.referencingTable)),
  );
  return {
    snapshot: {
      databaseName: snapshot.databaseName,
      serverVersion: null,
      extractedAt: snapshot.extractedAt,
      tables: snapshot.tables.filter((table) => visible.has(entityKey(table.name))),
      views: snapshot.views.filter((view) => visible.has(entityKey(view.name))),
      foreignKeys: snapshot.foreignKeys.filter(
        (key) =>
          visible.has(entityKey(key.referencingTable)) &&
          visible.has(entityKey(key.referencedTable)),
      ),
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
    access: exportedAccess(snapshot),
  };
}
