import { Database, Search } from "lucide-react";

import { useI18n } from "@/shared/i18n/useI18n";
import { EmptyState } from "@/shared/ui/EmptyState";

import styles from "./EntitiesSidebar.module.css";

/** Lists the entities of the open project. Search and filtering arrive with the model loading. */
export function EntitiesSidebar() {
  const { t } = useI18n();

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.title}>{t("sidebar.title")}</span>
        <span className={styles.count}>0</span>
      </div>
      <label className={styles.search}>
        <Search className={styles.searchIcon} aria-hidden="true" />
        <input
          type="search"
          className={styles.searchInput}
          placeholder={t("sidebar.search")}
          aria-label={t("sidebar.search")}
          disabled
        />
      </label>
      <div className={styles.body}>
        <EmptyState
          icon={Database}
          title={t("sidebar.empty.title")}
          description={t("sidebar.empty.description")}
        />
      </div>
    </div>
  );
}
