import { create } from "zustand";
import { persist } from "zustand/middleware";

import { detectInitialLocale } from "@/shared/i18n/locales";
import type { Locale } from "@/shared/i18n/locales";

import type { ThemePreference } from "./theme";

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 560;
export const SIDEBAR_DEFAULT_WIDTH = 280;

/** Keeps the entities panel wide enough for its search box and never wider than half a screen. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return SIDEBAR_DEFAULT_WIDTH;
  }
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

interface SettingsState {
  themePreference: ThemePreference;
  locale: Locale;
  isSidebarOpen: boolean;
  /** Width of the entities panel in pixels, within the clamp. */
  sidebarWidth: number;
  setThemePreference: (preference: ThemePreference) => void;
  setLocale: (locale: Locale) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
  setSidebarWidth: (width: number) => void;
}

const SETTINGS_STORAGE_KEY = "schemacraft.settings";

/** User preferences that survive restarts. Persisted in the webview's local storage. */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themePreference: "system",
      locale: detectInitialLocale(navigator.languages),
      isSidebarOpen: true,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      setThemePreference: (themePreference) => {
        set({ themePreference });
      },
      setLocale: (locale) => {
        set({ locale });
      },
      toggleSidebar: () => {
        set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
      },
      setSidebarOpen: (isSidebarOpen) => {
        set({ isSidebarOpen });
      },
      setSidebarWidth: (width) => {
        set({ sidebarWidth: clampSidebarWidth(width) });
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
      partialize: (state) => ({
        themePreference: state.themePreference,
        locale: state.locale,
        isSidebarOpen: state.isSidebarOpen,
        sidebarWidth: state.sidebarWidth,
      }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          ...stored,
          sidebarWidth: clampSidebarWidth(stored.sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH),
        };
      },
    },
  ),
);
