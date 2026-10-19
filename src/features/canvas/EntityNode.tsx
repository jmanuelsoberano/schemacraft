import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import {
  ChevronDown,
  ChevronRight,
  Glasses,
  KeyRound,
  Link2,
  Table2,
  Zap,
  ZapOff,
} from "lucide-react";
import { memo } from "react";

import { formatDataType } from "@/features/schema/dataType";
import { displayIdentifier, qualifiedNameLabel } from "@/features/schema/entities";
import { useI18n } from "@/shared/i18n/useI18n";
import { classNames } from "@/shared/ui/classNames";

import styles from "./EntityNode.module.css";
import { useCanvasUiStore } from "./canvasUiStore";
import type { ColumnRole } from "./geometry";
import type { EntityNode as EntityNodeType } from "./graph";
import { triggerBadgeLabel } from "./triggerBadgeText";

function RoleIcon({ role }: { role: ColumnRole }) {
  if (role === "plain") {
    return <span className={styles.roleSpacer} aria-hidden="true" />;
  }
  return (
    <span className={styles.role} aria-hidden="true">
      {role === "primary" || role === "both" ? <KeyRound className={styles.primaryIcon} /> : null}
      {role === "foreign" || role === "both" ? <Link2 className={styles.foreignIcon} /> : null}
    </span>
  );
}

/**
 * A table or view on the canvas. A view is told apart by its icon, its VIEW label and its own
 * colour, never by a dashed border; at the keys level it has no rows, so it is a header-only
 * card with the label and the column count. While the Inspector points at a rule that involves
 * the card, the card is outlined and the rule's rows it shows are tinted; the outline still
 * says so when the rows are collapsed or not shown at this level. Only the card's own entry of
 * the highlight is read, so pointing at a rule redraws the cards it involves and no others.
 */
function EntityNodeComponent({ id, data, selected }: NodeProps<EntityNodeType>) {
  const translator = useI18n();
  const { t, tCount } = translator;
  const ruleColumns = useCanvasUiStore((state) => state.ruleHighlight?.columns.get(id));
  const { entity, rows, detailLevel, isCollapsed, isCollapsible, isHighlighted } = data;
  const isView = entity.kind === "view";
  const isRuleTarget = ruleColumns !== undefined && ruleColumns.size > 0;
  const CollapseIcon = isCollapsed ? ChevronRight : ChevronDown;
  const TriggerIcon = entity.triggers?.allDisabled ? ZapOff : Zap;
  const triggerLabel =
    entity.triggers === null ? null : triggerBadgeLabel(entity.triggers, translator);

  return (
    <div
      className={classNames(
        styles.node,
        isView && styles.view,
        selected && styles.selected,
        isHighlighted && styles.highlighted,
        isRuleTarget && styles.ruleTarget,
      )}
      title={qualifiedNameLabel(entity.name)}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={styles.handle}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        className={styles.handle}
        isConnectable={false}
      />
      <header className={styles.header}>
        {isView ? (
          // The visible label names the kind, so the icon says nothing more.
          <Glasses className={styles.kindIcon} aria-hidden="true" />
        ) : (
          <Table2 className={styles.kindIcon} aria-label={t("entity.table")} />
        )}
        <span className={styles.title}>
          <span className={styles.schema}>{displayIdentifier(entity.name.schema)}.</span>
          <span className={styles.name}>{displayIdentifier(entity.name.name)}</span>
        </span>
        {isView ? <span className={styles.kindLabel}>{t("entity.view.label")}</span> : null}
        {entity.triggers === null ? null : (
          <span
            role="img"
            className={classNames(
              styles.triggers,
              entity.triggers.allDisabled && styles.triggersDisabled,
            )}
            aria-label={triggerLabel ?? undefined}
            title={triggerLabel ?? undefined}
          >
            <TriggerIcon className={styles.triggerIcon} aria-hidden="true" />
            <span aria-hidden="true">{entity.triggers.count}</span>
          </span>
        )}
        <span className={styles.count} aria-label={tCount("entity.columns", entity.columns.length)}>
          {entity.columns.length}
        </span>
        {isCollapsible ? (
          <button
            type="button"
            className={classNames(styles.collapse, "nodrag")}
            aria-label={isCollapsed ? t("canvas.node.expand") : t("canvas.node.collapse")}
            aria-expanded={!isCollapsed}
            data-collapse-toggle={id}
          >
            <CollapseIcon aria-hidden="true" />
          </button>
        ) : null}
      </header>
      {rows.length > 0 ? (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li
              key={row.column.name}
              className={classNames(
                styles.row,
                ruleColumns?.has(row.column.name) === true && styles.ruleColumn,
              )}
            >
              <RoleIcon role={row.role} />
              <span className={styles.columnName}>{row.column.name}</span>
              {detailLevel === "full" ? (
                <span className={styles.columnType}>
                  {formatDataType(row.column.dataType)}
                  {row.column.isNullable ? <span className={styles.nullable}>?</span> : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export const EntityNode = memo(EntityNodeComponent);
