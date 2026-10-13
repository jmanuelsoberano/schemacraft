import { Columns3, Database, Eye, EyeOff, Search, SearchX, Table2 } from "lucide-react";
import { useMemo, useState } from "react";

import { withHidden } from "@/features/canvas/canvasState";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import { entityKey } from "@/features/canvas/geometry";
import { useProjectStore } from "@/features/project/projectStore";
import {
  countEntities,
  filterEntityGroups,
  groupEntitiesBySchema,
} from "@/features/schema/entities";
import { useI18n } from "@/shared/i18n/useI18n";
import { EmptyState } from "@/shared/ui/EmptyState";
import { classNames } from "@/shared/ui/classNames";

import styles from "./EntitiesSidebar.module.css";

/**
 * Lists the tables and views of the open project, grouped by schema and searchable. Clicking an
 * entity centres it on the canvas; the eye toggles its visibility.
 */
export function EntitiesSidebar() {
  const { t, tCount, locale } = useI18n();
  const snapshot = useProjectStore((state) => state.project?.content.snapshot ?? null);
  const nodeStates = useProjectStore((state) => state.project?.content.canvas.nodes ?? null);
  const updateCanvas = useProjectStore((state) => state.updateCanvas);
  const focusEntity = useCanvasUiStore((state) => state.focusEntity);
  const openContextMenu = useCanvasUiStore((state) => state.openContextMenu);
  const selectedKeys = useCanvasUiStore((state) => state.selectedKeys);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => (snapshot ? groupEntitiesBySchema(snapshot) : []), [snapshot]);
  const visibleGroups = useMemo(() => filterEntityGroups(groups, query), [groups, query]);
  const hiddenKeys = useMemo(
    () =>
      new Set(
        (nodeStates ?? []).filter((node) => node.isHidden).map((node) => entityKey(node.name)),
      ),
    [nodeStates],
  );
  const totalCount = countEntities(groups);
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  const toggleVisibility = (key: string) => {
    const isHidden = hiddenKeys.has(key);
    updateCanvas((canvas) => withHidden(canvas, [key], !isHidden));
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.title}>{t("sidebar.title")}</span>
        <span className={styles.count}>
          {hiddenKeys.size > 0
            ? `${(totalCount - hiddenKeys.size).toLocaleString(locale)} / ${totalCount.toLocaleString(locale)}`
            : totalCount.toLocaleString(locale)}
        </span>
      </div>
      <label className={styles.search}>
        <Search className={styles.searchIcon} aria-hidden="true" />
        <input
          type="search"
          className={styles.searchInput}
          placeholder={t("sidebar.search")}
          aria-label={t("sidebar.search")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          disabled={snapshot === null}
        />
      </label>
      <div className={styles.body}>
        {snapshot === null ? (
          <EmptyState
            icon={Database}
            title={t("sidebar.empty.title")}
            description={t("sidebar.empty.description")}
          />
        ) : visibleGroups.length === 0 ? (
          <EmptyState icon={SearchX} title={t("sidebar.search.noMatches", { query })} />
        ) : (
          <ul className={styles.groups}>
            {visibleGroups.map((group) => {
              const hiddenInGroup = group.entities.filter((entity) =>
                hiddenKeys.has(entity.key),
              ).length;
              return (
                <li key={group.schema} className={styles.group}>
                  <div className={styles.groupHeader}>
                    <span className={styles.groupName}>{group.schema}</span>
                    <span className={styles.groupCount}>
                      {hiddenInGroup > 0
                        ? `${group.entities.length - hiddenInGroup} / ${group.entities.length}`
                        : group.entities.length}
                    </span>
                  </div>
                  <ul className={styles.entities}>
                    {group.entities.map((entity) => {
                      const isHidden = hiddenKeys.has(entity.key);
                      return (
                        <li
                          key={entity.key}
                          className={classNames(
                            styles.entity,
                            isHidden && styles.entityHidden,
                            selected.has(entity.key) && styles.entitySelected,
                          )}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            openContextMenu({
                              key: entity.key,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                        >
                          <button
                            type="button"
                            className={styles.entityButton}
                            title={entity.key}
                            aria-label={t("sidebar.center", { name: entity.key })}
                            onClick={() => {
                              focusEntity(entity.key);
                            }}
                          >
                            {entity.kind === "table" ? (
                              <Table2 className={styles.entityIcon} aria-hidden="true" />
                            ) : (
                              <Columns3 className={styles.entityIcon} aria-hidden="true" />
                            )}
                            <span className={styles.entityName}>{entity.name}</span>
                            <span
                              className={styles.entityColumns}
                              aria-label={tCount("entity.columns", entity.columnCount)}
                            >
                              {entity.columnCount}
                            </span>
                          </button>
                          <button
                            type="button"
                            className={styles.visibility}
                            aria-label={
                              isHidden
                                ? t("sidebar.show", { name: entity.key })
                                : t("sidebar.hide", { name: entity.key })
                            }
                            aria-pressed={!isHidden}
                            onClick={() => {
                              toggleVisibility(entity.key);
                            }}
                          >
                            {isHidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
