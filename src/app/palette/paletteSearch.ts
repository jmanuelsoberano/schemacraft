import type { ActionId } from "@/app/actions/action";
import type { EntityListItem } from "@/features/schema/entities";
import type { ModuleListItem } from "@/features/schema/modules";

/** An action as the palette lists it: already translated, with its shortcut rendered. */
export interface PaletteAction {
  id: ActionId;
  label: string;
  shortcut: string | null;
  isAvailable: boolean;
}

/** An inspectable object, with the parent included in a trigger's stable identity. */
export type PaletteObject =
  | Pick<EntityListItem, "key" | "schema" | "name" | "kind">
  | Pick<ModuleListItem, "key" | "schema" | "name" | "kind" | "ref">;

export type PaletteResult =
  { kind: "action"; action: PaletteAction } | { kind: "object"; object: PaletteObject };

const MAX_OBJECTS = 12;

function score(text: string, query: string): number {
  const haystack = text.toLowerCase();
  if (query === "") {
    return 1;
  }
  if (haystack === query) {
    return 4;
  }
  if (haystack.startsWith(query)) {
    return 3;
  }
  const wordStart = haystack.split(/[\s._]+/).some((word) => word.startsWith(query));
  if (wordStart) {
    return 2;
  }
  return haystack.includes(query) ? 1 : 0;
}

/**
 * Ranks actions and objects for `query`: exact and prefix matches first, then matches at the
 * start of a word, then any substring. Without a query every available action is listed.
 */
export function searchPalette(
  query: string,
  actions: readonly PaletteAction[],
  objects: readonly PaletteObject[],
): PaletteResult[] {
  const needle = query.trim().toLowerCase();
  const rankedActions = actions
    .filter((action) => action.isAvailable)
    .map((action) => ({ action, rank: score(action.label, needle) }))
    .filter((entry) => entry.rank > 0)
    .sort(
      (left, right) =>
        right.rank - left.rank || left.action.label.localeCompare(right.action.label),
    )
    .map((entry): PaletteResult => ({ kind: "action", action: entry.action }));

  if (needle === "") {
    return rankedActions;
  }

  const rankedObjects = objects
    .map((object) => {
      const parent =
        "ref" in object && object.ref.kind === "trigger"
          ? `${object.ref.parent.schema}.${object.ref.parent.name}`
          : "";
      return {
        object,
        rank: Math.max(
          score(object.name, needle),
          score(`${object.schema}.${object.name}`, needle) - 0.5,
          parent === "" ? 0 : score(parent, needle) - 0.5,
        ),
      };
    })
    .filter((entry) => entry.rank > 0)
    .sort(
      (left, right) =>
        right.rank - left.rank ||
        left.object.name.length - right.object.name.length ||
        left.object.key.localeCompare(right.object.key),
    )
    .slice(0, MAX_OBJECTS)
    .map((entry): PaletteResult => ({ kind: "object", object: entry.object }));

  return [...rankedActions, ...rankedObjects];
}
