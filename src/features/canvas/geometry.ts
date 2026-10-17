import { entityKey } from "@/features/schema/entities";
import type { EntityKind } from "@/features/schema/entities";
import type {
  Column,
  DetailLevel,
  ForeignKey,
  QualifiedName,
  SchemaSnapshot,
} from "@/shared/contracts";

/**
 * Pure geometry of diagram nodes. The canvas and the SVG exporter both read sizes, row positions
 * and attachment points from here, so what is exported is exactly what is on screen. Entity
 * identity (`entityKey`, `EntityKind`) lives in features/schema.
 */
export const NODE_WIDTH = 240;
export const HEADER_HEIGHT = 38;
export const ROW_HEIGHT = 22;
export const ROWS_PADDING_BOTTOM = 6;
/** Below this zoom factor nodes render compact whatever the chosen detail level. */
export const COMPACT_ZOOM_THRESHOLD = 0.4;

export type ColumnRole = "primary" | "foreign" | "both" | "plain";

/** A table or view with the key facts the diagram needs, computed once per snapshot. */
export interface EntityDescriptor {
  /** `schema.name`, the node id. */
  key: string;
  name: QualifiedName;
  kind: EntityKind;
  columns: readonly Column[];
  primaryKeyColumns: ReadonlySet<string>;
  foreignKeyColumns: ReadonlySet<string>;
}

/** A column as a node row. */
export interface ColumnRow {
  column: Column;
  role: ColumnRole;
}

/**
 * Every table and view of the snapshot, keyed by `schema.name`. A column of a foreign key to a
 * table the login cannot see is still a foreign key column: it keeps its badge, although no
 * relationship can be drawn for it.
 */
export function describeEntities(snapshot: SchemaSnapshot): Map<string, EntityDescriptor> {
  const foreignKeyColumns = new Map<string, Set<string>>();
  const addForeignKeyColumns = (owner: QualifiedName, names: readonly string[]) => {
    const key = entityKey(owner);
    const columns = foreignKeyColumns.get(key) ?? new Set<string>();
    for (const name of names) {
      columns.add(name);
    }
    foreignKeyColumns.set(key, columns);
  };
  for (const key of snapshot.foreignKeys) {
    addForeignKeyColumns(
      key.referencingTable,
      key.columnPairs.map((pair) => pair.referencingColumn),
    );
  }
  for (const key of snapshot.foreignKeysToInvisibleTables ?? []) {
    addForeignKeyColumns(key.referencingTable, key.columns);
  }

  const entities = new Map<string, EntityDescriptor>();
  for (const table of snapshot.tables) {
    const key = entityKey(table.name);
    entities.set(key, {
      key,
      name: table.name,
      kind: "table",
      columns: table.columns,
      primaryKeyColumns: new Set(table.primaryKey?.columns ?? []),
      foreignKeyColumns: foreignKeyColumns.get(key) ?? new Set(),
    });
  }
  for (const view of snapshot.views) {
    const key = entityKey(view.name);
    entities.set(key, {
      key,
      name: view.name,
      kind: "view",
      columns: view.columns,
      primaryKeyColumns: new Set(),
      foreignKeyColumns: new Set(),
    });
  }
  return entities;
}

export function columnRole(entity: EntityDescriptor, columnName: string): ColumnRole {
  const isPrimary = entity.primaryKeyColumns.has(columnName);
  const isForeign = entity.foreignKeyColumns.has(columnName);
  if (isPrimary && isForeign) {
    return "both";
  }
  if (isPrimary) {
    return "primary";
  }
  if (isForeign) {
    return "foreign";
  }
  return "plain";
}

/** Rows a node shows at a detail level; a collapsed node shows none. */
export function rowsFor(
  entity: EntityDescriptor,
  detailLevel: DetailLevel,
  isCollapsed: boolean,
): ColumnRow[] {
  if (isCollapsed || detailLevel === "compact") {
    return [];
  }
  return entity.columns
    .map((column) => ({ column, role: columnRole(entity, column.name) }))
    .filter((row) => detailLevel === "full" || row.role !== "plain");
}

/**
 * Whether a node has rows to hide at a detail level, so the collapse toggle is worth showing.
 * Nothing is collapsible at "compact"; a view at "keys" shows no rows either, because views have
 * no keys, so it is a header-only card there.
 */
export function isCollapsible(entity: EntityDescriptor, detailLevel: DetailLevel): boolean {
  return rowsFor(entity, detailLevel, false).length > 0;
}

export function nodeHeight(rowCount: number): number {
  return HEADER_HEIGHT + (rowCount === 0 ? 0 : rowCount * ROW_HEIGHT + ROWS_PADDING_BOTTOM);
}

/** Vertical centre of a row, relative to the node's top edge. */
export function rowCenterY(rowIndex: number): number {
  return HEADER_HEIGHT + rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
}

/**
 * Where a relationship touches the node vertically: the row of the column when it is shown,
 * otherwise the middle of the header.
 */
export function attachmentY(rows: readonly ColumnRow[], columnName: string): number {
  const index = rows.findIndex((row) => row.column.name === columnName);
  return index === -1 ? HEADER_HEIGHT / 2 : rowCenterY(index);
}

/**
 * Where a relationship attaches at each end, relative to the top of the referencing and the
 * referenced node: at the first column pair of the key, through {@link attachmentY}.
 */
export function relationOffsets(
  foreignKey: ForeignKey,
  sourceRows: readonly ColumnRow[],
  targetRows: readonly ColumnRow[],
): [number, number] {
  const firstPair = foreignKey.columnPairs[0];
  return [
    attachmentY(sourceRows, firstPair?.referencingColumn ?? ""),
    attachmentY(targetRows, firstPair?.referencedColumn ?? ""),
  ];
}

/** The detail level actually rendered at a zoom factor (semantic zoom). */
export function effectiveDetailLevel(detailLevel: DetailLevel, zoom: number): DetailLevel {
  return zoom < COMPACT_ZOOM_THRESHOLD ? "compact" : detailLevel;
}
