import { KeyRound, Languages, Monitor, Moon, Rows3, Sun, Table2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import { ActionButton } from "@/app/actions/ActionButton";
import { ActionIconButton } from "@/app/actions/ActionIconButton";
import type { ActionsById } from "@/app/actions/action";
import { Logo } from "@/app/brand/Logo";
import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import { useI18n } from "@/shared/i18n/useI18n";
import { useSettingsStore } from "@/shared/settings/settingsStore";
import type { ThemePreference } from "@/shared/settings/theme";
import { IconButton } from "@/shared/ui/IconButton";
import { RadioMenu } from "@/shared/ui/RadioMenu";
import type { RadioMenuOption } from "@/shared/ui/RadioMenu";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import type { SegmentedOption } from "@/shared/ui/SegmentedControl";

import styles from "./TopBar.module.css";

type ViewMode = "compact" | "keys" | "full";

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
  const [viewMode, setViewMode] = useState<ViewMode>("keys");
  const themePreference = useSettingsStore((state) => state.themePreference);
  const setThemePreference = useSettingsStore((state) => state.setThemePreference);
  const locale = useSettingsStore((state) => state.locale);
  const setLocale = useSettingsStore((state) => state.setLocale);
  const isSidebarOpen = useSettingsStore((state) => state.isSidebarOpen);

  const viewModeOptions: readonly SegmentedOption<ViewMode>[] = [
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

  return (
    <header className={styles.topBar}>
      <div className={styles.left}>
        <div className={styles.brand}>
          <Logo size={20} />
          <span>{t("app.name")}</span>
        </div>
        <span className={styles.separator} aria-hidden="true" />
        <span className={styles.projectName}>{t("project.untitled")}</span>
      </div>

      <div className={styles.center}>
        <SegmentedControl
          ariaLabel={t("viewMode.label")}
          value={viewMode}
          options={viewModeOptions}
          onValueChange={setViewMode}
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
        <ActionIconButton action={actions["project.refreshFromDatabase"]} />
        <span className={styles.separator} aria-hidden="true" />
        <ActionIconButton action={actions["diagram.autoLayout"]} />
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
