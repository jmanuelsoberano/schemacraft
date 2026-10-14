import type { Point, SchemaSnapshot } from "@/shared/contracts";

import { NODE_WIDTH, entityKey, nodeHeight, rowsFor } from "../geometry";
import type { EntityDescriptor } from "../geometry";
import type { DetailLevel } from "@/shared/contracts";

/** A node as the layout engines see it: an id and a box. */
export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

/** A directed edge from the referencing table to the referenced one. */
export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

/** Everything a layout needs. Positions are the current top-left corners. */
export interface LayoutInput {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  positions: ReadonlyMap<string, Point>;
}

/** Top-left positions produced by a layout, keyed by node id. */
export type LayoutResult = Map<string, Point>;

/**
 * Layout input for the visible entities at a detail level. Edges between the same pair of
 * nodes are kept (they weigh in), self-references are dropped (they only loop).
 */
export function buildLayoutInput(
  snapshot: SchemaSnapshot,
  entities: ReadonlyMap<string, EntityDescriptor>,
  visible: ReadonlySet<string>,
  detailLevel: DetailLevel,
  collapsed: ReadonlySet<string>,
  positions: ReadonlyMap<string, Point>,
): LayoutInput {
  const nodes: LayoutNode[] = [];
  for (const entity of entities.values()) {
    if (!visible.has(entity.key)) {
      continue;
    }
    const rows = rowsFor(entity, detailLevel, collapsed.has(entity.key));
    nodes.push({ id: entity.key, width: NODE_WIDTH, height: nodeHeight(rows.length) });
  }
  const edges: LayoutEdge[] = [];
  for (const key of snapshot.foreignKeys) {
    const source = entityKey(key.referencingTable);
    const target = entityKey(key.referencedTable);
    if (source === target || !visible.has(source) || !visible.has(target)) {
      continue;
    }
    edges.push({ id: `${source}.${key.name}`, source, target });
  }
  return { nodes, edges, positions };
}

/** Undirected adjacency of the layout graph. */
export function adjacency(input: LayoutInput): Map<string, Set<string>> {
  const neighbours = new Map<string, Set<string>>();
  for (const node of input.nodes) {
    neighbours.set(node.id, new Set());
  }
  for (const edge of input.edges) {
    neighbours.get(edge.source)?.add(edge.target);
    neighbours.get(edge.target)?.add(edge.source);
  }
  return neighbours;
}

/** Ids of the nodes that take part in no edge, in input order. */
export function detachedNodeIds(input: LayoutInput): string[] {
  const linked = new Set<string>();
  for (const edge of input.edges) {
    linked.add(edge.source);
    linked.add(edge.target);
  }
  return input.nodes.map((node) => node.id).filter((id) => !linked.has(id));
}

const DETACHED_GAP = 40;
const DETACHED_BLOCK_GAP = 120;
const MIN_DETACHED_COLUMNS = 4;

/**
 * Adds the detached nodes as a block of rows under the positioned ones, about as wide as the
 * diagram above and never narrower than four columns, so they never dilute a layout.
 */
export function placeDetachedBelow(
  positions: ReadonlyMap<string, Point>,
  input: LayoutInput,
  detached: readonly string[],
): LayoutResult {
  const result: LayoutResult = new Map(positions);
  if (detached.length === 0) {
    return result;
  }
  const sizes = new Map(input.nodes.map((node) => [node.id, node]));
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [id, point] of positions) {
    const size = sizes.get(id);
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x + (size?.width ?? NODE_WIDTH));
    maxY = Math.max(maxY, point.y + (size?.height ?? 0));
  }
  const hasDiagram = positions.size > 0;
  const columnWidth = NODE_WIDTH + DETACHED_GAP;
  const columns = Math.max(
    MIN_DETACHED_COLUMNS,
    hasDiagram
      ? Math.floor((maxX - minX + DETACHED_GAP) / columnWidth)
      : Math.ceil(Math.sqrt(detached.length)),
  );
  const startX = hasDiagram ? minX : 0;
  let y = hasDiagram ? maxY + DETACHED_BLOCK_GAP : 0;
  let column = 0;
  let rowHeight = 0;
  for (const id of detached) {
    if (column === columns) {
      column = 0;
      y += rowHeight + DETACHED_GAP;
      rowHeight = 0;
    }
    result.set(id, { x: startX + column * columnWidth, y });
    rowHeight = Math.max(rowHeight, sizes.get(id)?.height ?? 0);
    column += 1;
  }
  return result;
}

/** Shifts positions so the diagram starts near the origin, keeping relative placement. */
export function normalizePositions(
  positions: ReadonlyMap<string, Point>,
  margin = 40,
): LayoutResult {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const point of positions.values()) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return new Map(positions);
  }
  const result: LayoutResult = new Map();
  for (const [id, point] of positions) {
    result.set(id, {
      x: Math.round(point.x - minX + margin),
      y: Math.round(point.y - minY + margin),
    });
  }
  return result;
}
