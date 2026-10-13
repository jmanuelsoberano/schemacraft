import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  useInternalNode,
} from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { memo } from "react";

import { classNames } from "@/shared/ui/classNames";

import styles from "./RelationEdge.module.css";
import { MARKER_MANY, MARKER_MANY_OPTIONAL, MARKER_ONE } from "./RelationMarkers";
import { useCanvasUiStore } from "./canvasUiStore";
import { NODE_WIDTH, attachmentY, nodeHeight } from "./geometry";
import type { RelationEdge as RelationEdgeType } from "./graph";

/** Minimum horizontal room for a straight-through connection between two nodes. */
const SIDE_GAP = 24;
/** How far a self-reference loops out of the node. */
const LOOP_REACH = 44;

interface Anchor {
  x: number;
  y: number;
  position: Position;
}

interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Attachment points on both nodes, chosen so the edge leaves by the nearest sides. */
function anchors(
  source: NodeBox,
  sourceOffsetY: number,
  target: NodeBox,
  targetOffsetY: number,
): [Anchor, Anchor] {
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
  // Overlapping columns: connect through the nearer sides anyway, bending around the gap.
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

function selfLoopPath(box: NodeBox, fromY: number, toY: number): [string, number, number] {
  const x = box.x + box.width;
  const top = box.y + Math.min(fromY, toY);
  const bottom = box.y + Math.max(fromY, toY);
  const reach = x + LOOP_REACH;
  const path = `M ${x},${top} C ${reach},${top} ${reach},${bottom} ${x},${bottom}`;
  return [path, reach - 4, (top + bottom) / 2];
}

function RelationEdgeComponent({
  id,
  source,
  target,
  data,
  selected,
}: EdgeProps<RelationEdgeType>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const hoveredEdgeId = useCanvasUiStore((state) => state.hoveredEdgeId);
  const setHoveredEdge = useCanvasUiStore((state) => state.setHoveredEdge);

  if (!sourceNode || !targetNode || !data) {
    return null;
  }

  const sourceBox: NodeBox = {
    x: sourceNode.internals.positionAbsolute.x,
    y: sourceNode.internals.positionAbsolute.y,
    width: sourceNode.measured.width ?? NODE_WIDTH,
    height: sourceNode.measured.height ?? nodeHeight(data.sourceRows.length),
  };
  const targetBox: NodeBox = {
    x: targetNode.internals.positionAbsolute.x,
    y: targetNode.internals.positionAbsolute.y,
    width: targetNode.measured.width ?? NODE_WIDTH,
    height: targetNode.measured.height ?? nodeHeight(data.targetRows.length),
  };
  const { foreignKey } = data;
  const firstPair = foreignKey.columnPairs[0];
  const sourceOffsetY = attachmentY(data.sourceRows, firstPair?.referencingColumn ?? "");
  const targetOffsetY = attachmentY(data.targetRows, firstPair?.referencedColumn ?? "");

  let path: string;
  let labelX: number;
  let labelY: number;
  if (source === target) {
    [path, labelX, labelY] = selfLoopPath(sourceBox, sourceOffsetY, targetOffsetY);
  } else {
    const [from, to] = anchors(sourceBox, sourceOffsetY, targetBox, targetOffsetY);
    [path, labelX, labelY] = getSmoothStepPath({
      sourceX: from.x,
      sourceY: from.y,
      sourcePosition: from.position,
      targetX: to.x,
      targetY: to.y,
      targetPosition: to.position,
      borderRadius: 8,
      offset: 16,
    });
  }

  const isHovered = hoveredEdgeId === id;
  const isEmphasized = selected === true || isHovered;
  const columns = foreignKey.columnPairs
    .map((pair) => `${pair.referencingColumn} → ${pair.referencedColumn}`)
    .join(", ");

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={classNames(
          styles.edge,
          !foreignKey.isEnabled && styles.disabled,
          isEmphasized && styles.emphasized,
        )}
        markerStart={`url(#${data.isOptional ? MARKER_MANY_OPTIONAL : MARKER_MANY})`}
        markerEnd={`url(#${MARKER_ONE})`}
        interactionWidth={14}
      />
      <path
        d={path}
        className={styles.hitArea}
        onMouseEnter={() => {
          setHoveredEdge(id);
        }}
        onMouseLeave={() => {
          setHoveredEdge(null);
        }}
      />
      {isEmphasized ? (
        <EdgeLabelRenderer>
          <div
            className={styles.label}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <span className={styles.labelName}>{foreignKey.name}</span>
            <span className={styles.labelColumns}>{columns}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const RelationEdge = memo(RelationEdgeComponent);
