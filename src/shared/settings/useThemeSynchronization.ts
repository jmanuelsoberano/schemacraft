import { useEffect } from "react";

import { applyWindowTheme } from "@/shared/ipc/windowTheme";

import { useSettingsStore } from "./settingsStore";
import { DARK_SCHEME_MEDIA_QUERY, resolveTheme } from "./theme";

/**
 * Applies the theme preference to the document and to the native window frame, and follows
 * operating system changes while the preference is "system".
 */
export function useThemeSynchronization(): void {
  const themePreference = useSettingsStore((state) => state.themePreference);

  useEffect(() => {
    const darkSchemeQuery = window.matchMedia(DARK_SCHEME_MEDIA_QUERY);

    const apply = () => {
      const resolvedTheme = resolveTheme(themePreference, darkSchemeQuery.matches);
      if (themePreference === "system") {
        delete document.documentElement.dataset.theme;
      } else {
        document.documentElement.dataset.theme = resolvedTheme;
      }
      void applyWindowTheme(themePreference);
    };

    apply();
    darkSchemeQuery.addEventListener("change", apply);
    return () => {
      darkSchemeQuery.removeEventListener("change", apply);
    };
  }, [themePreference]);
}
