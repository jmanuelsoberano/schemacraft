import { BaseEdge, EdgeLabelRenderer, useInternalNode } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { memo } from "react";

import { classNames } from "@/shared/ui/classNames";

import styles from "./RelationEdge.module.css";
import { useCanvasUiStore } from "./canvasUiStore";
import { relationPath, startMarkerKind } from "./edgeGeometry";
import type { NodeBox } from "./edgeGeometry";
import { NODE_WIDTH, nodeHeight, relationOffsets } from "./geometry";
import type { RelationEdge as RelationEdgeType } from "./graph";
import { MARKER_IDS } from "./relationMarkerIds";

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
  const [sourceOffsetY, targetOffsetY] = relationOffsets(
    foreignKey,
    data.sourceRows,
    data.targetRows,
  );
  const [path, labelX, labelY] = relationPath(
    sourceBox,
    sourceOffsetY,
    targetBox,
    targetOffsetY,
    source === target,
  );

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
        markerStart={`url(#${MARKER_IDS[startMarkerKind(data.isOptional)]})`}
        markerEnd={`url(#${MARKER_IDS.one})`}
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
