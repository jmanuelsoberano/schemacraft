// The headless package, so the export renderer and the standalone viewer stay free of React.
import { Position, getSmoothStepPath } from "@xyflow/system";

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

/** The three crow's foot ends: many, zero or many (a circle before the foot) and one. */
export type RelationMarkerKind = "many" | "manyOptional" | "one";

/** A marker drawing; every marker is {@link MARKER_HEIGHT} high and {@link MARKER_REF_Y} deep. */
export interface RelationMarkerShape {
  /** Width of the marker's box, in path units. */
  width: number;
  /** Point of the box that sits on the end of the path. */
  refX: number;
  orient: "auto" | "auto-start-reverse";
  /** The strokes of the symbol. */
  path: string;
  /** The "zero" circle of an optional end, drawn in the canvas colour over the path. */
  circle?: { cx: number; cy: number; r: number };
}

export const MARKER_HEIGHT = 14;
export const MARKER_REF_Y = 7;

const CROWS_FOOT = "M13,7 L1,1 M13,7 L1,7 M13,7 L1,13";

/**
 * Crow's foot notation, drawn once for the canvas, the SVG exporter and the standalone viewer.
 * The "many" ends point into the path (`auto-start-reverse`) so the same shape serves as a
 * start marker; the "one" bar sits at the end of the path.
 */
export const RELATION_MARKER_SHAPES: Readonly<Record<RelationMarkerKind, RelationMarkerShape>> = {
  many: { width: 14, refX: 1, orient: "auto-start-reverse", path: CROWS_FOOT },
  manyOptional: {
    width: 22,
    refX: 1,
    orient: "auto-start-reverse",
    path: CROWS_FOOT,
    circle: { cx: 17, cy: 7, r: 3 },
  },
  one: { width: 14, refX: 13, orient: "auto", path: "M6,1 L6,13 M1,7 L13,7" },
};

/** The marker at the referencing end: "zero or many" when every key column accepts NULL. */
export function startMarkerKind(isOptional: boolean): RelationMarkerKind {
  return isOptional ? "manyOptional" : "many";
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

/** Path of a self-reference, looping out of the right side; also returns the label position. */
export function selfLoopPath(
  box: NodeBox,
  fromOffsetY: number,
  toOffsetY: number,
): [string, number, number] {
  const x = box.x + box.width;
  const top = box.y + Math.min(fromOffsetY, toOffsetY);
  const bottom = box.y + Math.max(fromOffsetY, toOffsetY);
  const reach = x + LOOP_REACH;
  const path = `M ${x},${top} C ${reach},${top} ${reach},${bottom} ${x},${bottom}`;
  return [path, reach - 4, (top + bottom) / 2];
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
