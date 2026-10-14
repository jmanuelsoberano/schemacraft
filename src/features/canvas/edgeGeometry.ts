// The headless package, so the export renderer and the standalone viewer stay free of React.
import { Position } from "@xyflow/system";

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
