import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { ThemePreference } from "@/shared/settings/theme";

/** Matches the native title bar to the application theme. No-op outside the Tauri runtime. */
export async function applyWindowTheme(preference: ThemePreference): Promise<void> {
  if (!isTauri()) {
    return;
  }
  try {
    await getCurrentWindow().setTheme(preference === "system" ? null : preference);
  } catch (error: unknown) {
    console.warn("Could not apply the window theme", error);
  }
}
