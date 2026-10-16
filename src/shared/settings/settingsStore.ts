import { create } from "zustand";
import { persist } from "zustand/middleware";

import { SUPPORTED_LOCALES, detectInitialLocale } from "@/shared/i18n/locales";
import type { Locale } from "@/shared/i18n/locales";
import type { PanelWidthLimits } from "@/shared/ui/PanelResizer";

import type { ThemePreference } from "./theme";

/** Keeps the entities panel wide enough for its search box and never wider than half a screen. */
export const SIDEBAR_WIDTH_LIMITS: PanelWidthLimits = { min: 220, max: 560, default: 280 };

/** The Inspector needs room for a column table with its badges; its ceiling is the sidebar's. */
export const INSPECTOR_WIDTH_LIMITS: PanelWidthLimits = { min: 280, max: 560, default: 360 };

/** How many dismissed access notices are remembered; the oldest are forgotten first. */
export const DISMISSED_ACCESS_NOTICES_LIMIT = 50;

const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/** A panel width within its limits, in whole pixels; the default when it is not a number. */
export function clampPanelWidth(width: number, limits: PanelWidthLimits): number {
  if (!Number.isFinite(width)) {
    return limits.default;
  }
  return Math.round(Math.min(limits.max, Math.max(limits.min, width)));
}

interface SettingsState {
  themePreference: ThemePreference;
  locale: Locale;
  isSidebarOpen: boolean;
  /** Width of the entities panel in pixels, within the clamp. */
  sidebarWidth: number;
  /** Width of the Inspector in pixels, within the clamp. Whether it is open is never saved. */
  inspectorWidth: number;
  /**
   * Signatures of the partial-access notices the user closed, most recent first. A signature
   * names the server, the database and the verdicts, so the notice returns when they change.
   */
  dismissedAccessNotices: readonly string[];
  setThemePreference: (preference: ThemePreference) => void;
  setLocale: (locale: Locale) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;
  dismissAccessNotice: (signature: string) => void;
}

/** The part of the settings written to local storage. */
export type PersistedSettings = Pick<
  SettingsState,
  | "themePreference"
  | "locale"
  | "isSidebarOpen"
  | "sidebarWidth"
  | "inspectorWidth"
  | "dismissedAccessNotices"
>;

const SETTINGS_STORAGE_KEY = "schemacraft.settings";

/** Adds `signature` in front, without duplicates and within the limit. */
function rememberSignature(signatures: readonly string[], signature: string): readonly string[] {
  return [signature, ...signatures.filter((existing) => existing !== signature)].slice(
    0,
    DISMISSED_ACCESS_NOTICES_LIMIT,
  );
}

/** A stored panel width, or the default when storage predates the panel or holds nonsense. */
function storedPanelWidth(value: unknown, limits: PanelWidthLimits): number {
  return clampPanelWidth(typeof value === "number" ? value : limits.default, limits);
}

/**
 * Combines what local storage holds with the defaults. Storage is user-editable and may come
 * from another version, so every field is checked on its own: a value of the wrong shape falls
 * back to the default instead of breaking the window, and the lists stay within their limits.
 */
export function mergePersistedSettings<State extends PersistedSettings>(
  persisted: unknown,
  current: State,
): State {
  const stored: Partial<Record<keyof PersistedSettings, unknown>> =
    typeof persisted === "object" && persisted !== null ? persisted : {};
  const {
    themePreference,
    locale,
    isSidebarOpen,
    sidebarWidth,
    inspectorWidth,
    dismissedAccessNotices,
  } = stored;
  return {
    ...current,
    themePreference:
      THEME_PREFERENCES.find((known) => known === themePreference) ?? current.themePreference,
    locale: SUPPORTED_LOCALES.find((known) => known === locale) ?? current.locale,
    isSidebarOpen: typeof isSidebarOpen === "boolean" ? isSidebarOpen : current.isSidebarOpen,
    sidebarWidth: storedPanelWidth(sidebarWidth, SIDEBAR_WIDTH_LIMITS),
    inspectorWidth: storedPanelWidth(inspectorWidth, INSPECTOR_WIDTH_LIMITS),
    dismissedAccessNotices: Array.isArray(dismissedAccessNotices)
      ? dismissedAccessNotices
          .filter((signature): signature is string => typeof signature === "string")
          .reduceRight<readonly string[]>(rememberSignature, [])
      : current.dismissedAccessNotices,
  };
}

/**
 * Conveniences of this window that survive restarts: theme, language, the two side panels and
 * the access notices already closed. Persisted in the webview's local storage, never secrets;
 * the connection history and recent projects live in the Rust-owned preferences file.
 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themePreference: "system",
      locale: detectInitialLocale(navigator.languages),
      isSidebarOpen: true,
      sidebarWidth: SIDEBAR_WIDTH_LIMITS.default,
      inspectorWidth: INSPECTOR_WIDTH_LIMITS.default,
      dismissedAccessNotices: [],
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
        set({ sidebarWidth: clampPanelWidth(width, SIDEBAR_WIDTH_LIMITS) });
      },
      setInspectorWidth: (width) => {
        set({ inspectorWidth: clampPanelWidth(width, INSPECTOR_WIDTH_LIMITS) });
      },
      dismissAccessNotice: (signature) => {
        set((state) => ({
          dismissedAccessNotices: rememberSignature(state.dismissedAccessNotices, signature),
        }));
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
      partialize: (state): PersistedSettings => ({
        themePreference: state.themePreference,
        locale: state.locale,
        isSidebarOpen: state.isSidebarOpen,
        sidebarWidth: state.sidebarWidth,
        inspectorWidth: state.inspectorWidth,
        dismissedAccessNotices: state.dismissedAccessNotices,
      }),
      merge: mergePersistedSettings,
    },
  ),
);
