import type { QualifiedName, SchemaSnapshot } from "@/shared/contracts";

/**
 * Identity of the entities a diagram shows. The canvas, the exports, the lists and the viewer
 * all name a table or view through this module, so a key is computed one way only.
 */
export type EntityKind = "table" | "view";

/** The kinds in the order lists show them: tables before views. */
export const ENTITY_KINDS: readonly EntityKind[] = ["table", "view"];

/** `schema.name`, the identity of a table or view: node id, list key and export attribute. */
export function entityKey(name: QualifiedName): string {
  return `${name.schema}.${name.name}`;
}

/** A table or view as the lists show it. */
export interface EntityListItem {
  /** Stable identity, e.g. `sales.Orders`. */
  key: string;
  schema: string;
  name: string;
  kind: EntityKind;
  columnCount: number;
}

/** The entities of one kind inside a schema group. */
export interface EntitySection {
  kind: EntityKind;
  entities: EntityListItem[];
}

/** The entities of one schema, split by kind in {@link ENTITY_KINDS} order. */
export interface EntityGroup {
  schema: string;
  sections: EntitySection[];
}

/** Which levels of a grouped list tell entities apart; a level that does not is left out. */
export interface EntityListShape {
  /** More than one schema is listed. */
  showsSchemas: boolean;
  /** Both tables and views are listed. */
  showsKinds: boolean;
}

/** Every table and view of the snapshot, tables first, each in snapshot order. */
export function listEntities(snapshot: SchemaSnapshot): EntityListItem[] {
  return [
    ...snapshot.tables.map((table) => ({
      key: entityKey(table.name),
      schema: table.name.schema,
      name: table.name.name,
      kind: "table" as const,
      columnCount: table.columns.length,
    })),
    ...snapshot.views.map((view) => ({
      key: entityKey(view.name),
      schema: view.name.schema,
      name: view.name.name,
      kind: "view" as const,
      columnCount: view.columns.length,
    })),
  ];
}

/**
 * Groups entities by schema, then by kind, every level sorted alphabetically. A schema holds
 * only the sections it has entities for, so a schema without views has one section.
 */
export function groupEntities(items: readonly EntityListItem[]): EntityGroup[] {
  const bySchema = new Map<string, EntityListItem[]>();
  for (const item of items) {
    const group = bySchema.get(item.schema) ?? [];
    group.push(item);
    bySchema.set(item.schema, group);
  }

  return [...bySchema.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([schema, entities]) => ({
      schema,
      sections: ENTITY_KINDS.map((kind) => ({
        kind,
        entities: entities
          .filter((entity) => entity.kind === kind)
          .sort((left, right) => left.name.localeCompare(right.name)),
      })).filter((section) => section.entities.length > 0),
    }));
}

/** Keeps the entities whose `schema.name` contains `query`, dropping empty sections and groups. */
export function filterEntityGroups(
  groups: readonly EntityGroup[],
  query: string,
): readonly EntityGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return groups;
  }
  return groups
    .map((group) => ({
      schema: group.schema,
      sections: group.sections
        .map((section) => ({
          kind: section.kind,
          entities: section.entities.filter((entity) => entity.key.toLowerCase().includes(needle)),
        }))
        .filter((section) => section.entities.length > 0),
    }))
    .filter((group) => group.sections.length > 0);
}

export function countEntities(groups: readonly EntityGroup[]): number {
  return groups.reduce(
    (total, group) =>
      total + group.sections.reduce((count, section) => count + section.entities.length, 0),
    0,
  );
}

/**
 * Which levels the grouped list shows. Decided on the unfiltered groups, so the structure
 * stays put while a search narrows the list.
 */
export function entityListShape(groups: readonly EntityGroup[]): EntityListShape {
  const kinds = new Set(groups.flatMap((group) => group.sections.map((section) => section.kind)));
  return { showsSchemas: groups.length > 1, showsKinds: kinds.size > 1 };
}
