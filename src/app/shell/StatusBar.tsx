import { Lock } from "lucide-react";

import type { ActionsById } from "@/app/actions/action";
import { formatShortcut, isApplePlatform } from "@/app/actions/shortcut";
import { DEVELOPER_NAME } from "@/shared/brand/credits";
import { useAboutStore } from "@/features/about/aboutStore";
import { AccessChip } from "@/features/access/AccessChip";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import { entityKey } from "@/features/canvas/geometry";
import { useProjectStore } from "@/features/project/projectStore";
import { describeSavedConnection } from "@/features/connection/fromSavedConnection";
import { listsEveryObject } from "@/features/schema/coverage";
import { useI18n } from "@/shared/i18n/useI18n";
import { useAppInfo } from "@/shared/ipc/useAppInfo";
import { Tooltip } from "@/shared/ui/Tooltip";
import { classNames } from "@/shared/ui/classNames";

import styles from "./StatusBar.module.css";

interface StatusBarProps {
  actions: ActionsById;
}

export function StatusBar({ actions }: StatusBarProps) {
  const { t, tCount } = useI18n();
  const appInfo = useAppInfo();
  const openAbout = useAboutStore((state) => state.open);
  const zoom = useCanvasUiStore((state) => state.zoom);
  const connection = useProjectStore((state) => state.project?.content.connection ?? null);
  const databaseName = useProjectStore(
    (state) => state.project?.content.snapshot.databaseName ?? null,
  );
  const tableCount = useProjectStore((state) => state.project?.content.snapshot.tables.length ?? 0);
  // Under partial access a zero is not a fact: other tables may exist that this login cannot
  // see. Counts above zero stay, and the access chip carries the caveat.
  const showsZeroCounts = useProjectStore((state) =>
    state.project === null ? true : listsEveryObject(state.project.content.snapshot),
  );
  const viewCount = useProjectStore((state) => state.project?.content.snapshot.views.length ?? 0);
  const hiddenCount = useProjectStore(
    (state) => state.project?.content.canvas.nodes.filter((node) => node.isHidden).length ?? 0,
  );
  const visibleRelationCount = useProjectStore((state) => {
    if (state.project === null) {
      return 0;
    }
    const hidden = new Set(
      state.project.content.canvas.nodes
        .filter((node) => node.isHidden)
        .map((node) => entityKey(node.name)),
    );
    return state.project.content.snapshot.foreignKeys.filter(
      (key) =>
        !hidden.has(entityKey(key.referencingTable)) && !hidden.has(entityKey(key.referencedTable)),
    ).length;
  });

  const isReadOnly = useProjectStore((state) => state.project?.isReadOnly ?? false);
  const savedWith = useProjectStore((state) => state.project?.savedWith ?? null);

  const accessReport = actions["view.accessReport"];

  return (
    <footer className={styles.statusBar}>
      <span className={styles.item}>
        <span
          className={classNames(styles.dot, connection !== null && styles.dotConnected)}
          aria-hidden="true"
        />
        {connection === null || databaseName === null
          ? t("statusBar.notConnected")
          : t("statusBar.connected", {
              target: describeSavedConnection(connection).target,
              database: databaseName,
            })}
      </span>
      <AccessChip
        onOpen={accessReport.run}
        shortcutHint={
          accessReport.shortcut === undefined
            ? undefined
            : formatShortcut(accessReport.shortcut, isApplePlatform())
        }
      />
      {isReadOnly ? (
        <Tooltip
          side="top"
          label={t("project.readOnly")}
          description={t("project.readOnly.description", {
            generator: savedWith ?? t("app.name"),
          })}
        >
          {/* Focusable so that keyboard users reach the explanation too. */}
          <span className={styles.readOnly} tabIndex={0}>
            <Lock className={styles.readOnlyIcon} aria-hidden="true" />
            {t("project.readOnly")}
          </span>
        </Tooltip>
      ) : null}
      {tableCount > 0 || showsZeroCounts ? (
        <span className={styles.item}>{tCount("statusBar.tables", tableCount)}</span>
      ) : null}
      {viewCount > 0 ? (
        <span className={styles.item}>{tCount("statusBar.views", viewCount)}</span>
      ) : null}
      {visibleRelationCount > 0 || showsZeroCounts ? (
        <span className={styles.item}>{tCount("statusBar.relations", visibleRelationCount)}</span>
      ) : null}
      {hiddenCount > 0 ? (
        <span className={styles.item}>{tCount("statusBar.hidden", hiddenCount)}</span>
      ) : null}
      <span className={styles.spacer} />
      <span className={styles.item}>
        {t("statusBar.zoom", { percent: Math.round(zoom * 100) })}
      </span>
      <span className={styles.item}>{t("credits.developedBy", { name: DEVELOPER_NAME })}</span>
      <button
        type="button"
        className={classNames(styles.item, styles.mono, styles.versionButton)}
        title={t("action.about")}
        aria-label={t("action.about")}
        onClick={openAbout}
      >
        {appInfo.status === "ready" ? (
          <>
            {t("statusBar.version", { version: appInfo.info.version })}
            {appInfo.info.isDebugBuild ? (
              <span className={styles.badge}>{t("statusBar.devBuild")}</span>
            ) : null}
          </>
        ) : null}
        {appInfo.status === "unavailable" ? t("statusBar.versionUnavailable") : null}
      </button>
    </footer>
  );
}
