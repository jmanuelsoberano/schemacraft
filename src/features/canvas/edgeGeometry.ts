// The headless package, so the export renderer and the standalone viewer stay free of React.
import { Position, getSmoothStepPath } from "@xyflow/system";

import type {
  ChildCardinality,
  ForeignKeyOptionality,
} from "@/features/schema/rules/foreignKeyReader";

/** Axis-aligned box of a node in canvas coordinates. */
export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where an edge touches a node and in which direction it leaves. */
export interface Anchor {
  x: number;
  y: number;
  position: Position;
}

/** Minimum clear room between two nodes for a straight-through connection. */
export const SIDE_GAP = 24;
/** How far a self-reference loops out of its node. */
export const LOOP_REACH = 44;
/**
 * How far the ends of a self-reference move off a shared attachment point: the referencing end
 * up, the referenced end down.
 */
export const LOOP_SPREAD = 8;

/**
 * The crow's foot ends, named by what they say: `many` (a crow's foot), `one` (a bar) and
 * `zeroOrOne` (a bar with a circle beyond it, "at most one, possibly none").
 */
export type RelationMarkerKind = "many" | "one" | "zeroOrOne";

/**
 * A marker drawing; every marker is {@link MARKER_HEIGHT} high and {@link MARKER_REF_Y} deep. It
 * is drawn as it meets its table: the table to the right of the box, the symbol reaching left
 * along the edge.
 */
export interface RelationMarkerShape {
  /** Width of the marker's box, in path units. */
  width: number;
  /** Point of the box that sits on the end of the path, where the edge meets the table. */
  refX: number;
  /** The strokes of the symbol. */
  path: string;
  /** The "zero" circle of an optional end, drawn in the canvas colour over the path. */
  circle?: { cx: number; cy: number; r: number };
}

export const MARKER_HEIGHT = 14;
export const MARKER_REF_Y = 7;

/**
 * How every marker turns with its edge. Each shape is drawn facing its table, which at the end
 * of a path is the referenced one; at the start, `auto-start-reverse` turns it round to face
 * the referencing table, so any shape serves at either end.
 */
export const MARKER_ORIENT = "auto-start-reverse";

/**
 * Crow's foot notation, drawn once for the canvas, the SVG exporter and the standalone viewer.
 * The crow's foot spreads its toes on the table; the bar of `one` and `zeroOrOne` sits at the
 * same distance from it, and the circle of `zeroOrOne` beyond the bar.
 */
export const RELATION_MARKER_SHAPES: Readonly<Record<RelationMarkerKind, RelationMarkerShape>> = {
  many: { width: 14, refX: 13, path: "M1,7 L13,1 M1,7 L13,7 M1,7 L13,13" },
  one: { width: 14, refX: 13, path: "M6,1 L6,13 M1,7 L13,7" },
  zeroOrOne: {
    width: 22,
    refX: 21,
    path: "M14,1 L14,13 M1,7 L21,7",
    circle: { cx: 6, cy: 7, r: 3 },
  },
};

/**
 * The marker at the referencing end: how many referencing rows one referenced row can have.
 * A one-to-one key reads "zero or one"; any other key a crow's foot, which allows any number,
 * one included. That covers a key made unique only by an index, which may be filtered.
 */
export function startMarkerKind(cardinality: ChildCardinality): RelationMarkerKind {
  return cardinality === "atMostOne" ? "zeroOrOne" : "many";
}

/**
 * The marker at the referenced end: how many referenced rows a referencing row points to.
 * "Zero or one" when a key column accepts NULL, since SQL Server checks a key only when all its
 * columns have a value; "one" otherwise.
 */
export function endMarkerKind(optionality: ForeignKeyOptionality): RelationMarkerKind {
  return optionality === "optional" ? "zeroOrOne" : "one";
}

/** Corner radius and the room an edge keeps before it turns, the same on every surface. */
const ROUTING = { borderRadius: 8, offset: 16 };

/**
 * Attachment points of a relationship. Nodes stacked vertically connect through their facing
 * top and bottom edges; nodes beside each other through their facing sides, at the row of the
 * key column; overlapping nodes leave through the same side and bend around.
 */
export function relationAnchors(
  source: NodeBox,
  sourceOffsetY: number,
  target: NodeBox,
  targetOffsetY: number,
): [Anchor, Anchor] {
  const horizontalGap = Math.max(
    target.x - (source.x + source.width),
    source.x - (target.x + target.width),
  );
  const verticalGap = Math.max(
    target.y - (source.y + source.height),
    source.y - (target.y + target.height),
  );

  if (verticalGap >= SIDE_GAP && verticalGap > horizontalGap) {
    if (source.y + source.height <= target.y) {
      return [
        { x: source.x + source.width / 2, y: source.y + source.height, position: Position.Bottom },
        { x: target.x + target.width / 2, y: target.y, position: Position.Top },
      ];
    }
    return [
      { x: source.x + source.width / 2, y: source.y, position: Position.Top },
      { x: target.x + target.width / 2, y: target.y + target.height, position: Position.Bottom },
    ];
  }
  if (source.x + source.width + SIDE_GAP <= target.x) {
    return [
      { x: source.x + source.width, y: source.y + sourceOffsetY, position: Position.Right },
      { x: target.x, y: target.y + targetOffsetY, position: Position.Left },
    ];
  }
  if (target.x + target.width + SIDE_GAP <= source.x) {
    return [
      { x: source.x, y: source.y + sourceOffsetY, position: Position.Left },
      { x: target.x + target.width, y: target.y + targetOffsetY, position: Position.Right },
    ];
  }
  const sourceCenter = source.x + source.width / 2;
  const targetCenter = target.x + target.width / 2;
  if (sourceCenter <= targetCenter) {
    return [
      { x: source.x + source.width, y: source.y + sourceOffsetY, position: Position.Right },
      { x: target.x + target.width, y: target.y + targetOffsetY, position: Position.Right },
    ];
  }
  return [
    { x: source.x, y: source.y + sourceOffsetY, position: Position.Left },
    { x: target.x, y: target.y + targetOffsetY, position: Position.Left },
  ];
}

/**
 * Path of a self-reference, looping out of the right side from the referencing row to the
 * referenced row, so each end's marker sits at its own column; also returns the label position.
 * Ends that attach at the same place, the header of a card whose rows are hidden, each move
 * {@link LOOP_SPREAD} off it, the referencing end up and the referenced end down, so the two
 * markers do not draw over each other.
 */
export function selfLoopPath(
  box: NodeBox,
  fromOffsetY: number,
  toOffsetY: number,
): [string, number, number] {
  const x = box.x + box.width;
  const spread = fromOffsetY === toOffsetY ? LOOP_SPREAD : 0;
  const from = box.y + fromOffsetY - spread;
  const to = box.y + toOffsetY + spread;
  const reach = x + LOOP_REACH;
  const path = `M ${x},${from} C ${reach},${from} ${reach},${to} ${x},${to}`;
  return [path, reach - 4, (from + to) / 2];
}

/**
 * Path of a relationship between two placed nodes and where its label sits: a loop when the
 * table references itself, otherwise a smooth step between the anchors of the two boxes.
 */
export function relationPath(
  source: NodeBox,
  sourceOffsetY: number,
  target: NodeBox,
  targetOffsetY: number,
  isSelfReference: boolean,
): [string, number, number] {
  if (isSelfReference) {
    return selfLoopPath(source, sourceOffsetY, targetOffsetY);
  }
  const [from, to] = relationAnchors(source, sourceOffsetY, target, targetOffsetY);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition: from.position,
    targetX: to.x,
    targetY: to.y,
    targetPosition: to.position,
    ...ROUTING,
  });
  return [path, labelX, labelY];
}
