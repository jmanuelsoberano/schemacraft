import { describeEntities, entityKey } from "@/features/canvas/geometry";
import { visibleEntityKeys } from "@/features/canvas/graph";
import type { CanvasState, DetailLevel, SchemaSnapshot } from "@/shared/contracts";
import type { Locale } from "@/shared/i18n/locales";

import type { ExportTheme } from "../svg/palette";

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
}

/** Id of the `<script type="application/json">` element that carries the data. */
export const VIEWER_DATA_ELEMENT_ID = "schemacraft-data";
/** Id of the element the viewer renders into. */
export const VIEWER_ROOT_ELEMENT_ID = "schemacraft-viewer";

/**
 * The schema and the canvas restricted to what is visible, so hidden tables never leave the
 * application, with the server version and the viewport dropped: the file carries only the
 * database name, the objects on the diagram and their positions.
 */
export function visibleProjection(
  snapshot: SchemaSnapshot,
  canvas: CanvasState,
): { snapshot: SchemaSnapshot; canvas: CanvasState } {
  const visible = visibleEntityKeys(describeEntities(snapshot), canvas.nodes);
  return {
    snapshot: {
      ...snapshot,
      serverVersion: null,
      tables: snapshot.tables.filter((table) => visible.has(entityKey(table.name))),
      views: snapshot.views.filter((view) => visible.has(entityKey(view.name))),
      foreignKeys: snapshot.foreignKeys.filter(
        (key) =>
          visible.has(entityKey(key.referencingTable)) &&
          visible.has(entityKey(key.referencedTable)),
      ),
    },
    canvas: {
      ...canvas,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: canvas.nodes.filter((node) => visible.has(entityKey(node.name))),
    },
  };
}
