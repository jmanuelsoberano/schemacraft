import { create } from "zustand";
import { persist } from "zustand/middleware";

import { detectInitialLocale } from "@/shared/i18n/locales";
import type { Locale } from "@/shared/i18n/locales";

import type { ThemePreference } from "./theme";

interface SettingsState {
  themePreference: ThemePreference;
  locale: Locale;
  isSidebarOpen: boolean;
  setThemePreference: (preference: ThemePreference) => void;
  setLocale: (locale: Locale) => void;
  toggleSidebar: () => void;
}

const SETTINGS_STORAGE_KEY = "schemacraft.settings";

/** User preferences that survive restarts. Persisted in the webview's local storage. */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themePreference: "system",
      locale: detectInitialLocale(navigator.languages),
      isSidebarOpen: true,
      setThemePreference: (themePreference) => {
        set({ themePreference });
      },
      setLocale: (locale) => {
        set({ locale });
      },
      toggleSidebar: () => {
        set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
      partialize: (state) => ({
        themePreference: state.themePreference,
        locale: state.locale,
        isSidebarOpen: state.isSidebarOpen,
      }),
    },
  ),
);
