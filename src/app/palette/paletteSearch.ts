import type { ActionId } from "@/app/actions/action";
import type { EntityListItem } from "@/features/schema/entities";

/** An action as the palette lists it: already translated, with its shortcut rendered. */
export interface PaletteAction {
  id: ActionId;
  label: string;
  shortcut: string | null;
  isAvailable: boolean;
}

/** An entity the palette can centre on. */
export type PaletteEntity = Pick<EntityListItem, "key" | "schema" | "name" | "kind">;

export type PaletteResult =
  { kind: "action"; action: PaletteAction } | { kind: "entity"; entity: PaletteEntity };

const MAX_ENTITIES = 12;

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
 * Ranks actions and entities for `query`: exact and prefix matches first, then matches at the
 * start of a word, then any substring. Without a query every available action is listed.
 */
export function searchPalette(
  query: string,
  actions: readonly PaletteAction[],
  entities: readonly PaletteEntity[],
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

  const rankedEntities = entities
    .map((entity) => ({
      entity,
      rank: Math.max(score(entity.name, needle), score(entity.key, needle) - 0.5),
    }))
    .filter((entry) => entry.rank > 0)
    .sort(
      (left, right) =>
        right.rank - left.rank ||
        left.entity.name.length - right.entity.name.length ||
        left.entity.key.localeCompare(right.entity.key),
    )
    .slice(0, MAX_ENTITIES)
    .map((entry): PaletteResult => ({ kind: "entity", entity: entry.entity }));

  return [...rankedActions, ...rankedEntities];
}
