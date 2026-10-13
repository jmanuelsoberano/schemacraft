import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, Columns3, KeyRound, Link2, Table2 } from "lucide-react";
import { memo } from "react";

import { formatDataType } from "@/features/schema/dataType";
import { useI18n } from "@/shared/i18n/useI18n";
import { classNames } from "@/shared/ui/classNames";

import styles from "./EntityNode.module.css";
import type { ColumnRole } from "./geometry";
import type { EntityNode as EntityNodeType } from "./graph";

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

function EntityNodeComponent({ id, data, selected }: NodeProps<EntityNodeType>) {
  const { t, tCount } = useI18n();
  const { entity, rows, detailLevel, isCollapsed, isHighlighted } = data;
  const CollapseIcon = isCollapsed ? ChevronRight : ChevronDown;
  const showsCollapseToggle = detailLevel !== "compact";

  return (
    <div
      className={classNames(
        styles.node,
        entity.kind === "view" && styles.view,
        selected && styles.selected,
        isHighlighted && styles.highlighted,
      )}
      title={entity.key}
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
        {entity.kind === "view" ? (
          <Columns3 className={styles.kindIcon} aria-label={t("entity.view")} />
        ) : (
          <Table2 className={styles.kindIcon} aria-label={t("entity.table")} />
        )}
        <span className={styles.title}>
          <span className={styles.schema}>{entity.name.schema}.</span>
          <span className={styles.name}>{entity.name.name}</span>
        </span>
        <span className={styles.count} aria-label={tCount("entity.columns", entity.columns.length)}>
          {entity.columns.length}
        </span>
        {showsCollapseToggle ? (
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
            <li key={row.column.name} className={styles.row}>
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
