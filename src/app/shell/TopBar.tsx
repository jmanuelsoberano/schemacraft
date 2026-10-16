import { Languages } from "lucide-react";

import { ActionButton } from "@/app/actions/ActionButton";
import { ActionIconButton } from "@/app/actions/ActionIconButton";
import type { ActionId, ActionsById } from "@/app/actions/action";
import { formatShortcut, isApplePlatform } from "@/app/actions/shortcut";
import { Logo } from "@/shared/brand/Logo";
import { projectDisplayName } from "@/features/project/projectPaths";
import { useProjectStore } from "@/features/project/projectStore";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import type { DetailLevel } from "@/shared/contracts";
import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import type { Locale } from "@/shared/i18n/locales";
import { useI18n } from "@/shared/i18n/useI18n";
import { useSettingsStore } from "@/shared/settings/settingsStore";
import type { ThemePreference } from "@/shared/settings/theme";
import { IconButton } from "@/shared/ui/IconButton";
import { RadioMenu } from "@/shared/ui/RadioMenu";
import type { RadioMenuOption } from "@/shared/ui/RadioMenu";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import type { SegmentedOption } from "@/shared/ui/SegmentedControl";

import { LayoutMenu } from "./LayoutMenu";
import styles from "./TopBar.module.css";

/*
 * The segmented control and the preference menus are faces of registry actions: the choice
 * runs the action, and the action lends its icon and shortcut, so the palette and the keyboard
 * can never disagree with the top bar.
 */
const DETAIL_LEVELS: readonly DetailLevel[] = ["compact", "keys", "full"];
const DETAIL_LEVEL_ACTIONS: Record<DetailLevel, ActionId> = {
  compact: "view.detailCompact",
  keys: "view.detailKeys",
  full: "view.detailFull",
};
const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];
const THEME_ACTIONS: Record<ThemePreference, ActionId> = {
  system: "settings.theme.system",
  light: "settings.theme.light",
  dark: "settings.theme.dark",
};
const LANGUAGE_ACTIONS: Record<Locale, ActionId> = {
  en: "settings.language.en",
  es: "settings.language.es",
};

interface TopBarProps {
  actions: ActionsById;
}

export function TopBar({ actions }: TopBarProps) {
  const { t } = useI18n();
  const projectPath = useProjectStore((state) => state.project?.path ?? null);
  const isDirty = useProjectStore((state) => state.project?.isDirty ?? false);
  const detailLevel = useProjectStore(
    (state) => state.project?.content.canvas.detailLevel ?? "keys",
  );
  const themePreference = useSettingsStore((state) => state.themePreference);
  const locale = useSettingsStore((state) => state.locale);
  const isSidebarOpen = useSettingsStore((state) => state.isSidebarOpen);
  const isInspectorOpen = useCanvasUiStore((state) => state.isInspectorOpen);
  const applePlatform = isApplePlatform();

  const detailLevelOptions: readonly SegmentedOption<DetailLevel>[] = DETAIL_LEVELS.map((level) => {
    const action = actions[DETAIL_LEVEL_ACTIONS[level]];
    return {
      value: level,
      label: t(`viewMode.${level}`),
      hint: t(`viewMode.${level}.hint`),
      shortcutHint: action.shortcut ? formatShortcut(action.shortcut, applePlatform) : undefined,
      icon: action.icon,
    };
  });

  const themeOptions: readonly RadioMenuOption<ThemePreference>[] = THEME_PREFERENCES.map(
    (preference) => ({
      value: preference,
      label: t(`theme.${preference}`),
      icon: actions[THEME_ACTIONS[preference]].icon,
    }),
  );

  const languageOptions = SUPPORTED_LOCALES.map((code) => ({
    value: code,
    label: t(`language.${code}`),
  }));

  const projectName =
    projectPath === null ? t("project.untitled") : projectDisplayName(projectPath);

  return (
    <header className={styles.topBar}>
      <div className={styles.left}>
        <div className={styles.brand}>
          <Logo size={20} />
          <span>{t("app.name")}</span>
        </div>
        <span className={styles.separator} aria-hidden="true" />
        <span className={styles.projectName} title={projectPath ?? undefined}>
          {projectName}
        </span>
        {isDirty ? (
          <span
            className={styles.unsavedDot}
            role="img"
            aria-label={t("project.unsavedChanges")}
            title={t("project.unsavedChanges")}
          />
        ) : null}
      </div>

      <div className={styles.center}>
        <SegmentedControl
          ariaLabel={t("viewMode.label")}
          value={detailLevel}
          options={detailLevelOptions}
          onValueChange={(level) => {
            actions[DETAIL_LEVEL_ACTIONS[level]].run();
          }}
          disabled={!actions[DETAIL_LEVEL_ACTIONS[detailLevel]].isAvailable}
        />
      </div>

      <div className={styles.right}>
        <ActionButton
          action={actions["project.connect"]}
          labelKey="toolbar.connect"
          variant="primary"
        />
        <ActionIconButton action={actions["project.openProject"]} />
        <ActionIconButton action={actions["project.saveProject"]} />
        <ActionIconButton action={actions["project.saveProjectAs"]} />
        <ActionIconButton action={actions["project.refreshFromDatabase"]} />
        <span className={styles.separator} aria-hidden="true" />
        <ActionIconButton action={actions["edit.undo"]} />
        <ActionIconButton action={actions["edit.redo"]} />
        <span className={styles.separator} aria-hidden="true" />
        <LayoutMenu actions={actions} />
        <ActionIconButton action={actions["diagram.export"]} />
        <span className={styles.separator} aria-hidden="true" />
        <RadioMenu
          label={t("menu.theme")}
          value={themePreference}
          options={themeOptions}
          onValueChange={(preference) => {
            actions[THEME_ACTIONS[preference]].run();
          }}
          trigger={
            <IconButton
              label={t("menu.theme")}
              icon={actions[THEME_ACTIONS[themePreference]].icon}
            />
          }
        />
        <RadioMenu
          label={t("menu.language")}
          value={locale}
          options={languageOptions}
          onValueChange={(code) => {
            actions[LANGUAGE_ACTIONS[code]].run();
          }}
          trigger={<IconButton label={t("menu.language")} icon={Languages} />}
        />
        <ActionIconButton action={actions["view.toggleSidebar"]} isActive={isSidebarOpen} />
        <ActionIconButton action={actions["view.toggleInspector"]} isActive={isInspectorOpen} />
      </div>
    </header>
  );
}
