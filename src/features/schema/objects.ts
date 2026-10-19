import type { SchemaSnapshot } from "@/shared/contracts";

import { listEntities, matchesQualifiedName } from "./entities";
import type { EntityListItem } from "./entities";
import { listModules } from "./modules";
import type { ModuleKind, ModuleListItem, ModuleRef } from "./modules";

export type RoutineListItem = Omit<ModuleListItem, "kind" | "ref"> & {
  kind: Exclude<ModuleKind, "trigger">;
  ref: Extract<ModuleRef, { kind: "routine" }>;
};

/** Objects listed in the sidebar. Triggers belong to the details of their parent. */
export type ObjectListItem = EntityListItem | RoutineListItem;
export type ObjectKind = ObjectListItem["kind"];
export const OBJECT_KINDS: readonly ObjectKind[] = [
  "table",
  "view",
  "procedure",
  "function",
  "unknown",
];
export const OBJECT_PAGE_SIZE = 200;
export const OBJECT_SEARCH_LIMIT = 200;

export interface ObjectSection {
  kind: ObjectKind;
  objects: ObjectListItem[];
}

export interface ObjectGroup {
  schema: string;
  sections: ObjectSection[];
}

export function isEntityItem(item: ObjectListItem): item is EntityListItem {
  return item.kind === "table" || item.kind === "view";
}

export function listObjects(snapshot: SchemaSnapshot): ObjectListItem[] {
  const routines: RoutineListItem[] = [];
  for (const item of listModules(snapshot)) {
    if (item.ref.kind === "routine" && item.kind !== "trigger") {
      routines.push({ ...item, ref: item.ref, kind: item.kind });
    }
  }
  return [...listEntities(snapshot), ...routines];
}

/** Schema and name order is shared by the full list, each page and search results. */
export function groupObjects(items: readonly ObjectListItem[]): ObjectGroup[] {
  const schemas = new Map<string, ObjectListItem[]>();
  for (const item of items) {
    const group = schemas.get(item.schema) ?? [];
    group.push(item);
    schemas.set(item.schema, group);
  }
  return [...schemas.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([schema, objects]) => ({
      schema,
      sections: OBJECT_KINDS.map((kind) => ({
        kind,
        objects: objects
          .filter((item) => item.kind === kind)
          .sort((left, right) => left.name.localeCompare(right.name)),
      })).filter((section) => section.objects.length > 0),
    }));
}

/** Evaluate on the complete list so typing never changes its grouping levels. */
export function objectListShape(groups: readonly ObjectGroup[]): {
  showsSchemas: boolean;
  showsKinds: boolean;
} {
  const kinds = new Set(groups.flatMap((group) => group.sections.map((section) => section.kind)));
  // A routine section remains a named, collapsed entry even in a code-only project.
  const hasRoutines = [...kinds].some((kind) => kind !== "table" && kind !== "view");
  return { showsSchemas: groups.length > 1, showsKinds: kinds.size > 1 || hasRoutines };
}

export function countObjects(groups: readonly ObjectGroup[]): number {
  return groups.reduce(
    (total, group) =>
      total + group.sections.reduce((count, section) => count + section.objects.length, 0),
    0,
  );
}

export interface ObjectSearchResult {
  groups: readonly ObjectGroup[];
  totalMatches: number;
  isLimited: boolean;
}

/** A single cap across schemas and kinds bounds the work of rendering a broad search. */
export function searchObjectGroups(
  groups: readonly ObjectGroup[],
  query: string,
): ObjectSearchResult {
  const needle = query.trim().toLowerCase();
  if (needle === "") return { groups, totalMatches: countObjects(groups), isLimited: false };
  let totalMatches = 0;
  const matches: ObjectGroup[] = [];
  for (const group of groups) {
    const sections: ObjectSection[] = [];
    for (const section of group.sections) {
      const objects = section.objects.filter((item) => {
        if (!matchesQualifiedName(item, needle)) return false;
        totalMatches += 1;
        return totalMatches <= OBJECT_SEARCH_LIMIT;
      });
      if (objects.length > 0) sections.push({ kind: section.kind, objects });
    }
    if (sections.length > 0) matches.push({ schema: group.schema, sections });
  }
  return { groups: matches, totalMatches, isLimited: totalMatches > OBJECT_SEARCH_LIMIT };
}

/** A section grows in fixed pages without removing rows the reader has already reached. */
export function objectPage(
  items: readonly ObjectListItem[],
  pages: number,
): readonly ObjectListItem[] {
  return items.slice(0, OBJECT_PAGE_SIZE * Math.max(1, pages));
}
