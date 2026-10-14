import type { SchemaSnapshot } from "@/shared/contracts";

export type EntityKind = "table" | "view";

/** A table or view as listed in the entities panel. */
export interface EntityListItem {
  /** Stable identity, e.g. `sales.Orders`. */
  key: string;
  schema: string;
  name: string;
  kind: EntityKind;
  columnCount: number;
}

export interface EntityGroup {
  schema: string;
  entities: EntityListItem[];
}

/** Entities grouped by schema, both levels sorted alphabetically, tables before views. */
export function groupEntitiesBySchema(snapshot: SchemaSnapshot): EntityGroup[] {
  const items: EntityListItem[] = [
    ...snapshot.tables.map((table) => ({
      key: `${table.name.schema}.${table.name.name}`,
      schema: table.name.schema,
      name: table.name.name,
      kind: "table" as const,
      columnCount: table.columns.length,
    })),
    ...snapshot.views.map((view) => ({
      key: `${view.name.schema}.${view.name.name}`,
      schema: view.name.schema,
      name: view.name.name,
      kind: "view" as const,
      columnCount: view.columns.length,
    })),
  ];

  const groups = new Map<string, EntityListItem[]>();
  for (const item of items) {
    const group = groups.get(item.schema) ?? [];
    group.push(item);
    groups.set(item.schema, group);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([schema, entities]) => ({
      schema,
      entities: entities.sort(
        (left, right) =>
          Number(left.kind === "view") - Number(right.kind === "view") ||
          left.name.localeCompare(right.name),
      ),
    }));
}

/** Keeps the entities whose name or schema contains `query`, dropping empty groups. */
export function filterEntityGroups(groups: EntityGroup[], query: string): EntityGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return groups;
  }
  return groups
    .map((group) => ({
      schema: group.schema,
      entities: group.entities.filter((entity) =>
        `${entity.schema}.${entity.name}`.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.entities.length > 0);
}

export function countEntities(groups: EntityGroup[]): number {
  return groups.reduce((total, group) => total + group.entities.length, 0);
}
