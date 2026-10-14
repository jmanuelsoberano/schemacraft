import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useInternalNode } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { memo } from "react";

import { classNames } from "@/shared/ui/classNames";

import styles from "./RelationEdge.module.css";
import { MARKER_MANY, MARKER_MANY_OPTIONAL, MARKER_ONE } from "./RelationMarkers";
import { useCanvasUiStore } from "./canvasUiStore";
import { relationAnchors, selfLoopPath } from "./edgeGeometry";
import type { NodeBox } from "./edgeGeometry";
import { NODE_WIDTH, attachmentY, nodeHeight } from "./geometry";
import type { RelationEdge as RelationEdgeType } from "./graph";

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
    const [from, to] = relationAnchors(sourceBox, sourceOffsetY, targetBox, targetOffsetY);
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
