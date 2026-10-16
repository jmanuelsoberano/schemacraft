import { entityKey } from "@/features/schema/entities";
import type { CanvasState, SchemaSnapshot } from "@/shared/contracts";

import { describeEntities } from "./geometry";
import { visibleEntityKeys } from "./graph";
import { buildLayoutInput, placeNearRelated } from "./layouts";

export interface RefreshPlacement {
  canvas: CanvasState;
  /** Keys of the entities that were placed, to highlight them. */
  placed: string[];
}

/**
 * Gives the entities that appeared with a refresh a position next to the tables they relate to,
 * leaving every existing position untouched. Entities already placed come back unchanged.
 */
export function placeRefreshedEntities(
  canvas: CanvasState,
  snapshot: SchemaSnapshot,
): RefreshPlacement {
  const entities = describeEntities(snapshot);
  const states = new Map(canvas.nodes.map((node) => [entityKey(node.name), node]));
  const unplaced = [...entities.keys()].filter((key) => !states.has(key));
  if (unplaced.length === 0) {
    return { canvas, placed: [] };
  }

  const positions = new Map(canvas.nodes.map((node) => [entityKey(node.name), node.position]));
  const visible = visibleEntityKeys(entities, canvas.nodes);
  for (const key of unplaced) {
    visible.add(key);
  }
  const collapsed = new Set(
    canvas.nodes.filter((node) => node.isCollapsed).map((node) => entityKey(node.name)),
  );
  const input = buildLayoutInput(
    snapshot,
    entities,
    visible,
    canvas.detailLevel,
    collapsed,
    positions,
  );
  const placement = placeNearRelated(input, unplaced);

  const nodes = [...canvas.nodes];
  for (const key of unplaced) {
    const entity = entities.get(key);
    const position = placement.get(key);
    if (entity === undefined || position === undefined) {
      continue;
    }
    nodes.push({ name: entity.name, position, isCollapsed: false, isHidden: false });
  }
  return { canvas: { ...canvas, nodes }, placed: unplaced };
}
