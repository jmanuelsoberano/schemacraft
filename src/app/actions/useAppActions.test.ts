import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionId } from "./action";
import { formatShortcut, isReservedBrowserShortcut } from "./shortcut";
import type { Shortcut, ShortcutKeyboardEvent } from "./shortcut";

// The registry reaches every store; the stores reach the Tauri wrappers, which the node
// environment cannot provide, and the settings store persists to a local storage it lacks.
const unreachable = vi.hoisted(() => () => Promise.reject(new Error("no backend in tests")));

vi.mock("@/shared/ipc/connectionBackend", () => ({ getConnectionBackend: unreachable }));
vi.mock("@/shared/ipc/credentialsBackend", () => ({ getCredentialsBackend: unreachable }));
vi.mock("@/shared/ipc/exportBackend", () => ({ getExportBackend: unreachable }));
vi.mock("@/shared/ipc/preferencesBackend", () => ({ getPreferencesBackend: unreachable }));
vi.mock("@/shared/ipc/projectBackend", () => ({
  PROJECT_FILE_EXTENSION: "scraft",
  getProjectBackend: unreachable,
}));
vi.mock("@/features/canvas/layouts/elkWorker", () => ({
  createElkInWorker: () => {
    throw new Error("the layout engine is not available in tests");
  },
}));
vi.mock("@/features/export/fontFaces", () => ({
  loadEmbeddedFontFaces: () => Promise.resolve(""),
}));
vi.stubGlobal("window", {
  localStorage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  },
  matchMedia: () => ({ matches: false }),
});

const { useCanvasUiStore } = await import("@/features/canvas/canvasUiStore");
const { useSettingsStore } = await import("@/shared/settings/settingsStore");
const { useAppActions } = await import("./useAppActions");
type AppActions = ReturnType<typeof useAppActions>;

/**
 * Browser accelerators an action reuses on purpose: reload for the refresh, print for the PDF,
 * the find bar for the entity search, history and downloads for show all and auto layout. The
 * registry matches them first, so they never reach the webview.
 */
const CLAIMED_BROWSER_SHORTCUTS: ReadonlySet<ActionId> = new Set([
  "project.refreshFromDatabase",
  "diagram.exportPdf",
  "view.searchEntities",
  "diagram.showAll",
  "diagram.autoLayout",
]);

function Probe({ report }: { report: (actions: AppActions) => void }) {
  report(useAppActions());
  return null;
}

/** The registry as the shell builds it, rendered once without a project, as at launch. */
function builtRegistry(): AppActions {
  const holder: { actions: AppActions | null } = { actions: null };
  renderToString(
    createElement(Probe, {
      report: (actions) => {
        holder.actions = actions;
      },
    }),
  );
  if (holder.actions === null) {
    throw new Error("the registry was not built");
  }
  return holder.actions;
}

/** The keystroke a shortcut describes, on Windows. */
function keystroke(shortcut: Shortcut): ShortcutKeyboardEvent {
  return {
    key: shortcut.key,
    ctrlKey: shortcut.mod ?? false,
    metaKey: false,
    shiftKey: shortcut.shift ?? false,
    altKey: shortcut.alt ?? false,
  };
}

beforeEach(() => {
  useCanvasUiStore.setState({ isInspectorOpen: false, inspectorFocusRequest: 0 });
  useSettingsStore.setState({ themePreference: "system", locale: "en" });
});

describe("the action registry", () => {
  it("lists every action once, under its own id", () => {
    const { byId, list } = builtRegistry();
    expect(list).toEqual(Object.values(byId));
    for (const [id, action] of Object.entries(byId)) {
      expect(action.id).toBe(id);
    }
  });

  it("gives no two actions the same shortcut", () => {
    const owners = new Map<string, ActionId[]>();
    for (const action of builtRegistry().list) {
      if (action.shortcut) {
        const label = formatShortcut(action.shortcut, false);
        owners.set(label, [...(owners.get(label) ?? []), action.id]);
      }
    }
    const shared = [...owners].filter(([, ids]) => ids.length > 1);
    expect(shared).toEqual([]);
  });

  it("reuses a browser accelerator only where the list above says so", () => {
    for (const action of builtRegistry().list) {
      if (action.shortcut) {
        expect(isReservedBrowserShortcut(keystroke(action.shortcut), false), action.id).toBe(
          CLAIMED_BROWSER_SHORTCUTS.has(action.id),
        );
      }
    }
  });

  it("opens the Inspector and the detail levels from the keyboard, with a project only", () => {
    const { byId } = builtRegistry();
    expect(byId["view.toggleInspector"].shortcut).toEqual({ mod: true, key: "i" });
    expect(byId["view.detailCompact"].shortcut).toEqual({ mod: true, key: "1" });
    expect(byId["view.detailKeys"].shortcut).toEqual({ mod: true, key: "2" });
    expect(byId["view.detailFull"].shortcut).toEqual({ mod: true, key: "3" });
    for (const id of [
      "view.toggleInspector",
      "view.detailCompact",
      "view.detailKeys",
      "view.detailFull",
    ] as const) {
      expect(byId[id], id).toMatchObject({
        isAvailable: false,
        unavailableReason: "action.unavailable.noProject",
      });
    }
  });

  it("toggles the Inspector and asks it to take focus", () => {
    const { byId } = builtRegistry();
    byId["view.toggleInspector"].run();
    expect(useCanvasUiStore.getState()).toMatchObject({
      isInspectorOpen: true,
      inspectorFocusRequest: 1,
    });
    byId["view.toggleInspector"].run();
    expect(useCanvasUiStore.getState().isInspectorOpen).toBe(false);
  });

  it("switches the theme and the language through the settings, without shortcuts", () => {
    const { byId } = builtRegistry();
    const preferences = [
      "settings.theme.system",
      "settings.theme.light",
      "settings.theme.dark",
      "settings.language.en",
      "settings.language.es",
    ] as const;
    for (const id of preferences) {
      expect(byId[id].isAvailable, id).toBe(true);
      expect(byId[id].shortcut, id).toBeUndefined();
    }
    byId["settings.theme.dark"].run();
    expect(useSettingsStore.getState().themePreference).toBe("dark");
    byId["settings.theme.light"].run();
    expect(useSettingsStore.getState().themePreference).toBe("light");
    byId["settings.language.es"].run();
    expect(useSettingsStore.getState().locale).toBe("es");
    byId["settings.language.en"].run();
    expect(useSettingsStore.getState().locale).toBe("en");
  });
});
