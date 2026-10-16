import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { ThemePreference } from "@/shared/settings/theme";

/**
 * The native window, behind the same IPC boundary as every Rust command: features call these
 * functions instead of the Tauri window API. Each one does nothing outside the Tauri runtime.
 */

/** Matches the native title bar to the application theme. */
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

/** Shows `title` in the native title bar and the taskbar. */
export async function setWindowTitle(title: string): Promise<void> {
  if (!isTauri()) {
    return;
  }
  try {
    await getCurrentWindow().setTitle(title);
  } catch (error: unknown) {
    console.warn("Could not update the window title", error);
  }
}

/**
 * Calls `onCloseRequested` when the user asks to close the window. The handler returns `true` to
 * keep the window open; it can close it later with {@link closeWindow}. Resolves to a function
 * that stops watching.
 */
export async function watchWindowClose(onCloseRequested: () => boolean): Promise<() => void> {
  if (!isTauri()) {
    return () => undefined;
  }
  try {
    return await getCurrentWindow().onCloseRequested((event) => {
      if (onCloseRequested()) {
        event.preventDefault();
      }
    });
  } catch (error: unknown) {
    console.warn("Could not watch the window close request", error);
    return () => undefined;
  }
}

/** Closes the window without asking again. */
export async function closeWindow(): Promise<void> {
  if (!isTauri()) {
    return;
  }
  try {
    await getCurrentWindow().destroy();
  } catch (error: unknown) {
    console.warn("Could not close the window", error);
  }
}
