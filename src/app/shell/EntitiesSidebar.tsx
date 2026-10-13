import { Database, Eye, Search, SearchX, Table2 } from "lucide-react";
import { useMemo, useState } from "react";

import {
  countEntities,
  filterEntityGroups,
  groupEntitiesBySchema,
} from "@/features/schema/entities";
import { useSchemaStore } from "@/features/schema/schemaStore";
import { useI18n } from "@/shared/i18n/useI18n";
import { EmptyState } from "@/shared/ui/EmptyState";

import styles from "./EntitiesSidebar.module.css";

/** Lists the tables and views of the loaded schema, grouped by schema and searchable. */
export function EntitiesSidebar() {
  const { t, tCount, locale } = useI18n();
  const snapshot = useSchemaStore((state) => state.snapshot);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => (snapshot ? groupEntitiesBySchema(snapshot) : []), [snapshot]);
  const visibleGroups = useMemo(() => filterEntityGroups(groups, query), [groups, query]);
  const totalCount = countEntities(groups);

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.title}>{t("sidebar.title")}</span>
        <span className={styles.count}>{totalCount.toLocaleString(locale)}</span>
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
            {visibleGroups.map((group) => (
              <li key={group.schema} className={styles.group}>
                <div className={styles.groupHeader}>
                  <span className={styles.groupName}>{group.schema}</span>
                  <span className={styles.groupCount}>{group.entities.length}</span>
                </div>
                <ul className={styles.entities}>
                  {group.entities.map((entity) => (
                    <li key={entity.key} className={styles.entity} title={entity.key}>
                      {entity.kind === "table" ? (
                        <Table2 className={styles.entityIcon} aria-label={t("entity.table")} />
                      ) : (
                        <Eye className={styles.entityIcon} aria-label={t("entity.view")} />
                      )}
                      <span className={styles.entityName}>{entity.name}</span>
                      <span
                        className={styles.entityColumns}
                        aria-label={tCount("entity.columns", entity.columnCount)}
                      >
                        {entity.columnCount}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
