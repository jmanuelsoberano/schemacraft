import type {
  CanvasState,
  DetailLevel,
  NodeState,
  Point,
  QualifiedName,
  SchemaSnapshot,
} from "@/shared/contracts";

import { describeEntities, entityKey, nodeHeight, NODE_WIDTH, rowsFor } from "./geometry";
import { gridPosition } from "./graph";
import { resolveOverlaps } from "./layouts/overlaps";
import type { PlacedBox } from "./layouts/overlaps";

/**
 * Pure transformations of the saved canvas state. Every entity of the snapshot always has a
 * node state once `ensurePlaced` ran, so the other helpers can assume one exists.
 */

const GRID_ROW_HEIGHT = nodeHeight(6);

function sameName(left: QualifiedName, right: QualifiedName): boolean {
  return left.schema === right.schema && left.name === right.name;
}

/**
 * Gives every table and view of the snapshot a node state. Missing ones get grid positions
 * below the existing diagram; states of entities that no longer exist are dropped.
 */
export function ensurePlaced(canvas: CanvasState, snapshot: SchemaSnapshot): CanvasState {
  const names = [
    ...snapshot.tables.map((table) => table.name),
    ...snapshot.views.map((view) => view.name),
  ];
  const existing = new Map(canvas.nodes.map((node) => [entityKey(node.name), node]));
  const kept = names
    .map((name) => existing.get(entityKey(name)))
    .filter((node): node is NodeState => node !== undefined);
  const missing = names.filter((name) => !existing.has(entityKey(name)));
  if (missing.length === 0 && kept.length === canvas.nodes.length) {
    return canvas;
  }

  const bottom = kept.reduce((max, node) => Math.max(max, node.position.y + GRID_ROW_HEIGHT), 0);
  const placed = missing.map((name, index) => {
    const grid = gridPosition(index);
    return {
      name,
      position: { x: grid.x, y: grid.y + (kept.length === 0 ? 0 : bottom + 80) },
      isCollapsed: false,
      isHidden: false,
    };
  });
  return { ...canvas, nodes: [...kept, ...placed] };
}

/** Node states keyed by entity key. */
export function nodeStateFor(canvas: CanvasState, key: string): NodeState | undefined {
  return canvas.nodes.find((node) => entityKey(node.name) === key);
}

function updateNodes(
  canvas: CanvasState,
  keys: ReadonlySet<string>,
  update: (node: NodeState) => NodeState,
): CanvasState {
  const nodes = canvas.nodes.map((node) => (keys.has(entityKey(node.name)) ? update(node) : node));
  const changed = nodes.some((node, index) => node !== canvas.nodes[index]);
  return changed ? { ...canvas, nodes } : canvas;
}

/** Moves nodes; positions are keyed by entity key. Marks the layout as manual. */
export function withPositions(
  canvas: CanvasState,
  positions: ReadonlyMap<string, Point>,
): CanvasState {
  const moved = updateNodes(canvas, new Set(positions.keys()), (node) => {
    const position = positions.get(entityKey(node.name));
    if (
      position === undefined ||
      (position.x === node.position.x && position.y === node.position.y)
    ) {
      return node;
    }
    return { ...node, position: { x: position.x, y: position.y } };
  });
  return moved === canvas ? canvas : { ...moved, layout: "manual" };
}

/**
 * Positions that keep the visible nodes apart once they are drawn at `detailLevel`: a node that
 * would overlap a taller node above it moves down, never sideways or up. Only the nodes that
 * move are returned, so the map is empty when the level fits the current positions.
 */
export function spreadForDetailLevel(
  snapshot: SchemaSnapshot,
  canvas: CanvasState,
  detailLevel: DetailLevel,
): Map<string, Point> {
  const entities = describeEntities(snapshot);
  const boxes: PlacedBox[] = [];
  for (const node of canvas.nodes) {
    const key = entityKey(node.name);
    const entity = entities.get(key);
    if (node.isHidden || entity === undefined) {
      continue;
    }
    boxes.push({
      id: key,
      x: node.position.x,
      y: node.position.y,
      width: NODE_WIDTH,
      height: nodeHeight(rowsFor(entity, detailLevel, node.isCollapsed).length),
    });
  }
  const resolved = resolveOverlaps(boxes);
  const moved = new Map<string, Point>();
  for (const box of boxes) {
    const position = resolved.get(box.id);
    if (position !== undefined && (position.x !== box.x || position.y !== box.y)) {
      moved.set(box.id, position);
    }
  }
  return moved;
}

/** Replaces every position with the result of a layout and records which layout ran. */
export function withLayout(
  canvas: CanvasState,
  positions: ReadonlyMap<string, Point>,
  layout: CanvasState["layout"],
): CanvasState {
  const nodes = canvas.nodes.map((node) => {
    const position = positions.get(entityKey(node.name));
    return position === undefined ? node : { ...node, position: { x: position.x, y: position.y } };
  });
  return { ...canvas, nodes, layout };
}

export function withHidden(
  canvas: CanvasState,
  keys: readonly string[],
  isHidden: boolean,
): CanvasState {
  return updateNodes(canvas, new Set(keys), (node) =>
    node.isHidden === isHidden ? node : { ...node, isHidden },
  );
}

/** Shows only `keys`; everything else is hidden. */
export function withOnlyVisible(canvas: CanvasState, keys: ReadonlySet<string>): CanvasState {
  const nodes = canvas.nodes.map((node) => {
    const isHidden = !keys.has(entityKey(node.name));
    return node.isHidden === isHidden ? node : { ...node, isHidden };
  });
  return { ...canvas, nodes };
}

export function withCollapsed(
  canvas: CanvasState,
  keys: readonly string[],
  isCollapsed: boolean,
): CanvasState {
  return updateNodes(canvas, new Set(keys), (node) =>
    node.isCollapsed === isCollapsed ? node : { ...node, isCollapsed },
  );
}

export function toggleCollapsed(canvas: CanvasState, key: string): CanvasState {
  const current = nodeStateFor(canvas, key);
  return current === undefined ? canvas : withCollapsed(canvas, [key], !current.isCollapsed);
}

/** Bounding box of the placed nodes, or `null` when there are none. */
export function nodesBounds(
  canvas: CanvasState,
  heightOf: (node: NodeState) => number = () => GRID_ROW_HEIGHT,
): { x: number; y: number; width: number; height: number } | null {
  if (canvas.nodes.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of canvas.nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + NODE_WIDTH);
    maxY = Math.max(maxY, node.position.y + heightOf(node));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export { sameName };
