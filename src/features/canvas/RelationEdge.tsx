import { BaseEdge, EdgeLabelRenderer, useInternalNode } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { memo } from "react";

import { formatRuleText, ruleTextToString } from "@/features/schema/rules/ruleText";
import { useI18n } from "@/shared/i18n/useI18n";
import { classNames } from "@/shared/ui/classNames";

import styles from "./RelationEdge.module.css";
import { useCanvasUiStore } from "./canvasUiStore";
import { relationPath } from "./edgeGeometry";
import type { NodeBox } from "./edgeGeometry";
import { NODE_WIDTH, nodeHeight, relationOffsets } from "./geometry";
import type { RelationEdge as RelationEdgeType } from "./graph";
import { MARKER_IDS } from "./relationMarkerIds";

/**
 * A relationship between two cards. Hovering or selecting it shows a label with the key's name,
 * its column pairs and what deleting a referenced row does, the fact most often looked for on a
 * relationship; on a disabled key that sentence sits under "When enabled:", as the Inspector
 * says it. The Inspector emphasises the line while a reader points at the key there, without the
 * label, which would cover the columns the cards highlight.
 */
function RelationEdgeComponent({
  id,
  source,
  target,
  data,
  selected,
}: EdgeProps<RelationEdgeType>) {
  const translator = useI18n();
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const isHovered = useCanvasUiStore((state) => state.hoveredEdgeId === id);
  const isRuleTarget = useCanvasUiStore((state) => state.ruleHighlight?.edgeId === id);
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

  const isLabelShown = selected === true || isHovered;
  const isEmphasized = isLabelShown || isRuleTarget;
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
        markerStart={`url(#${MARKER_IDS[data.ends.start]})`}
        markerEnd={`url(#${MARKER_IDS[data.ends.end]})`}
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
      {isLabelShown ? (
        <EdgeLabelRenderer>
          <div
            className={styles.label}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <span className={styles.labelName}>{foreignKey.name}</span>
            <span className={styles.labelColumns}>{columns}</span>
            {foreignKey.isEnabled ? null : (
              <span className={styles.labelCondition}>{translator.t("rule.whenEnabled")}</span>
            )}
            <span className={styles.labelRule}>
              {ruleTextToString(formatRuleText(data.explanation.deleteRule, translator))}
            </span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const RelationEdge = memo(RelationEdgeComponent);
