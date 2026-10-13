import { KeyRound, Languages, Monitor, Moon, Rows3, Sun, Table2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { ActionButton } from "@/app/actions/ActionButton";
import { ActionIconButton } from "@/app/actions/ActionIconButton";
import type { ActionsById } from "@/app/actions/action";
import { Logo } from "@/app/brand/Logo";
import { projectDisplayName } from "@/features/project/projectPaths";
import { useProjectStore } from "@/features/project/projectStore";
import type { DetailLevel } from "@/shared/contracts";
import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
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

const THEME_ICONS: Record<ThemePreference, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

interface TopBarProps {
  actions: ActionsById;
}

export function TopBar({ actions }: TopBarProps) {
  const { t } = useI18n();
  const projectPath = useProjectStore((state) => state.project?.path ?? null);
  const hasProject = useProjectStore((state) => state.project !== null);
  const isDirty = useProjectStore((state) => state.project?.isDirty ?? false);
  const detailLevel = useProjectStore(
    (state) => state.project?.content.canvas.detailLevel ?? "keys",
  );
  const setDetailLevel = useProjectStore((state) => state.setDetailLevel);
  const themePreference = useSettingsStore((state) => state.themePreference);
  const setThemePreference = useSettingsStore((state) => state.setThemePreference);
  const locale = useSettingsStore((state) => state.locale);
  const setLocale = useSettingsStore((state) => state.setLocale);
  const isSidebarOpen = useSettingsStore((state) => state.isSidebarOpen);

  const detailLevelOptions: readonly SegmentedOption<DetailLevel>[] = [
    {
      value: "compact",
      label: t("viewMode.compact"),
      hint: t("viewMode.compact.hint"),
      icon: Rows3,
    },
    { value: "keys", label: t("viewMode.keys"), hint: t("viewMode.keys.hint"), icon: KeyRound },
    { value: "full", label: t("viewMode.full"), hint: t("viewMode.full.hint"), icon: Table2 },
  ];

  const themeOptions: readonly RadioMenuOption<ThemePreference>[] = [
    { value: "system", label: t("theme.system"), icon: Monitor },
    { value: "light", label: t("theme.light"), icon: Sun },
    { value: "dark", label: t("theme.dark"), icon: Moon },
  ];

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
          onValueChange={setDetailLevel}
          disabled={!hasProject}
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
          onValueChange={setThemePreference}
          trigger={<IconButton label={t("menu.theme")} icon={THEME_ICONS[themePreference]} />}
        />
        <RadioMenu
          label={t("menu.language")}
          value={locale}
          options={languageOptions}
          onValueChange={setLocale}
          trigger={<IconButton label={t("menu.language")} icon={Languages} />}
        />
        <ActionIconButton action={actions["view.toggleSidebar"]} isActive={isSidebarOpen} />
      </div>
    </header>
  );
}
