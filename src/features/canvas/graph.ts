import type { Edge, Node } from "@xyflow/react";

import { entityKey, foreignKeyId } from "@/features/schema/entities";
import {
  foreignKeyChildCardinality,
  foreignKeyExplanation,
  foreignKeyOptionality,
} from "@/features/schema/rules/foreignKeyReader";
import type { ForeignKeyExplanation } from "@/features/schema/rules/foreignKeyReader";
import type { DetailLevel, ForeignKey, NodeState, SchemaSnapshot, Table } from "@/shared/contracts";

import { endMarkerKind, startMarkerKind } from "./edgeGeometry";
import type { RelationMarkerKind } from "./edgeGeometry";
import { NODE_WIDTH, isCollapsible, nodeHeight, rowsFor } from "./geometry";
import type { ColumnRow, EntityDescriptor } from "./geometry";

/** What a table node renders. */
export interface EntityNodeData {
  entity: EntityDescriptor;
  rows: ColumnRow[];
  detailLevel: DetailLevel;
  isCollapsed: boolean;
  /** Whether the node has rows to hide at this level; a header-only card shows no toggle. */
  isCollapsible: boolean;
  /** Recently added by a refresh, highlighted for a moment. */
  isHighlighted: boolean;
  [key: string]: unknown;
}

/** The crow's foot markers at the two ends of a relationship. */
export interface RelationEnds {
  /** At the referencing table: a crow's foot, or "zero or one" for a one-to-one key. */
  start: RelationMarkerKind;
  /** At the referenced table: "one", or "zero or one" when a key column accepts NULL. */
  end: RelationMarkerKind;
}

/** What a relationship edge renders. */
export interface RelationEdgeData {
  foreignKey: ForeignKey;
  /** Rows of the referencing node, to attach the edge at the key column. */
  sourceRows: ColumnRow[];
  /** Rows of the referenced node. */
  targetRows: ColumnRow[];
  ends: RelationEnds;
  /** The key in words, for the hover label; worked out once per snapshot. */
  explanation: ForeignKeyExplanation;
  [key: string]: unknown;
}

export type EntityNode = Node<EntityNodeData, "entity">;
export type RelationEdge = Edge<RelationEdgeData, "relation">;

export const ENTITY_NODE_TYPE = "entity";
export const RELATION_EDGE_TYPE = "relation";

export function relationEdgeId(foreignKey: ForeignKey): string {
  return foreignKeyId(foreignKey);
}

/** Node states keyed by entity key, for quick lookups. */
export function nodeStatesByKey(nodeStates: readonly NodeState[]): Map<string, NodeState> {
  return new Map(nodeStates.map((node) => [entityKey(node.name), node]));
}

/** Keys of the entities currently shown on the canvas. */
export function visibleEntityKeys(
  entities: ReadonlyMap<string, EntityDescriptor>,
  nodeStates: readonly NodeState[],
): Set<string> {
  const states = nodeStatesByKey(nodeStates);
  const visible = new Set<string>();
  for (const key of entities.keys()) {
    if (states.get(key)?.isHidden !== true) {
      visible.add(key);
    }
  }
  return visible;
}

/**
 * React Flow nodes for the visible entities. Entities without a saved position are placed on a
 * grid; `ensurePlaced` normally gives every entity a position before this runs.
 */
export function buildEntityNodes(
  entities: ReadonlyMap<string, EntityDescriptor>,
  nodeStates: readonly NodeState[],
  detailLevel: DetailLevel,
  highlighted: ReadonlySet<string> = new Set(),
): EntityNode[] {
  const states = nodeStatesByKey(nodeStates);
  const nodes: EntityNode[] = [];
  let unplaced = 0;
  for (const entity of entities.values()) {
    const state = states.get(entity.key);
    if (state?.isHidden === true) {
      continue;
    }
    const isCollapsed = state?.isCollapsed ?? false;
    const rows = rowsFor(entity, detailLevel, isCollapsed);
    const position = state?.position ?? gridPosition(unplaced);
    if (state === undefined) {
      unplaced += 1;
    }
    nodes.push({
      id: entity.key,
      type: ENTITY_NODE_TYPE,
      position: { x: position.x, y: position.y },
      width: NODE_WIDTH,
      height: nodeHeight(rows.length),
      data: {
        entity,
        rows,
        detailLevel,
        isCollapsed,
        isCollapsible: isCollapsible(entity, detailLevel),
        isHighlighted: highlighted.has(entity.key),
      },
    });
  }
  return nodes;
}

/** Edges for the foreign keys whose both ends are visible. */
export function buildRelationEdges(
  snapshot: SchemaSnapshot,
  nodes: readonly EntityNode[],
): RelationEdge[] {
  const rowsByKey = new Map(nodes.map((node) => [node.id, node.data.rows]));
  const tables = tablesByKey(snapshot);
  const edges: RelationEdge[] = [];
  for (const foreignKey of snapshot.foreignKeys) {
    const source = entityKey(foreignKey.referencingTable);
    const target = entityKey(foreignKey.referencedTable);
    const sourceRows = rowsByKey.get(source);
    const targetRows = rowsByKey.get(target);
    if (sourceRows === undefined || targetRows === undefined) {
      continue;
    }
    edges.push({
      id: relationEdgeId(foreignKey),
      type: RELATION_EDGE_TYPE,
      source,
      target,
      data: {
        foreignKey,
        sourceRows,
        targetRows,
        ends: relationEnds(tables.get(source), foreignKey),
        explanation: foreignKeyExplanation(snapshot, foreignKey),
      },
    });
  }
  return edges;
}

/** The tables of `snapshot` by entity key, where a relationship finds its referencing table. */
export function tablesByKey(snapshot: SchemaSnapshot): Map<string, Table> {
  return new Map(snapshot.tables.map((table) => [entityKey(table.name), table]));
}

/**
 * The markers of `foreignKey`, judged on its referencing table by the two functions its
 * sentences are built from (`features/schema/rules`), so the diagram and the words always
 * agree: zero or one at the referenced end when any key column accepts NULL, and at the
 * referencing end when the key is one-to-one.
 */
export function relationEnds(
  referencingTable: Table | undefined,
  foreignKey: ForeignKey,
): RelationEnds {
  return {
    start: startMarkerKind(foreignKeyChildCardinality(referencingTable, foreignKey)),
    end: endMarkerKind(foreignKeyOptionality(referencingTable?.columns ?? [], foreignKey)),
  };
}

/** Number of foreign keys drawn between the visible entities. */
export function countVisibleRelations(
  snapshot: SchemaSnapshot,
  visible: ReadonlySet<string>,
): number {
  return snapshot.foreignKeys.filter(
    (key) =>
      visible.has(entityKey(key.referencingTable)) && visible.has(entityKey(key.referencedTable)),
  ).length;
}

const GRID_COLUMNS = 6;
const GRID_GAP_X = 60;
const GRID_GAP_Y = 80;

/** Deterministic position for the n-th entity without a saved position. */
export function gridPosition(index: number): { x: number; y: number } {
  return {
    x: (index % GRID_COLUMNS) * (NODE_WIDTH + GRID_GAP_X),
    y: Math.floor(index / GRID_COLUMNS) * (nodeHeight(6) + GRID_GAP_Y),
  };
}
