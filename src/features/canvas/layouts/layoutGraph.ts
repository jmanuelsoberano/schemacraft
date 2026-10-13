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
