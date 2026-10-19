import { createElement } from "react";
import type * as React from "react";
import { renderToString } from "react-dom/server";
import { Search } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppAction } from "./action";
import type { Shortcut } from "./shortcut";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useEffect: (effect: () => void) => {
    effect();
  },
}));
vi.mock("@/shared/ipc/runtime", () => ({ isDesktopRuntime: () => true }));
const { useKeyboardShortcuts } = await import("./useKeyboardShortcuts");
const { useDesktopShellGuards } = await import("../shell/useDesktopShellGuards");

class Target {
  isContentEditable = false;
  readonly code: boolean;
  readonly findOpen: boolean;
  constructor(code = false, findOpen = false) {
    this.code = code;
    this.findOpen = findOpen;
  }
  closest() {
    return this.code ? this : null;
  }
  getAttribute() {
    return String(this.findOpen);
  }
}
class Input extends Target {}
const listeners = new Map<string, (event: unknown) => void>();

beforeEach(() => {
  listeners.clear();
  vi.stubGlobal("Element", Target);
  vi.stubGlobal("HTMLElement", Target);
  vi.stubGlobal("HTMLInputElement", Input);
  vi.stubGlobal("HTMLTextAreaElement", class extends Target {});
  vi.stubGlobal("HTMLSelectElement", class extends Target {});
  vi.stubGlobal("document", { querySelectorAll: () => [] });
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    removeEventListener: () => undefined,
  });
});

function Probe({ actions }: { actions: AppAction[] }) {
  useKeyboardShortcuts(actions);
  useDesktopShellGuards();
  return null;
}
function keyboard(shortcut: Shortcut, target: Target) {
  return {
    key: shortcut.key,
    ctrlKey: shortcut.mod ?? false,
    shiftKey: shortcut.shift ?? false,
    altKey: shortcut.alt ?? false,
    metaKey: false,
    target,
    repeat: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
  };
}

describe("code viewer keyboard ownership", () => {
  it("leaves owned keys untouched before running actions or browser guards", () => {
    const run = vi.fn();
    renderToString(
      createElement(Probe, {
        actions: [
          {
            id: "view.searchEntities",
            labelKey: "action.searchEntities",
            icon: Search,
            shortcut: { key: "f", mod: true },
            isAvailable: true,
            run,
          },
        ],
      }),
    );
    for (const shortcut of [
      { key: "f", mod: true },
      { key: "a", mod: true },
      { key: "F3" },
      { key: "F3", shift: true },
      { key: "Escape" },
    ]) {
      const event = keyboard(shortcut, new Target(true, true));
      listeners.get("keydown")?.(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(run).not.toHaveBeenCalled();
    const outside = keyboard({ key: "f", mod: true }, new Target());
    listeners.get("keydown")?.(outside);
    expect(outside.preventDefault).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    const browserFind = keyboard({ key: "F3" }, new Target());
    listeners.get("keydown")?.(browserFind);
    expect(browserFind.preventDefault).toHaveBeenCalledOnce();
  });
  it("keeps F5, F1, Ctrl+K and Ctrl+I global from the source", () => {
    for (const shortcut of [
      { key: "F5" },
      { key: "F1" },
      { key: "k", mod: true },
      { key: "i", mod: true },
    ]) {
      const run = vi.fn();
      renderToString(
        createElement(Probe, {
          actions: [
            {
              id: "view.toggleInspector",
              labelKey: "action.toggleInspector",
              icon: Search,
              shortcut,
              isAvailable: true,
              run,
            },
          ],
        }),
      );
      const event = keyboard(shortcut, new Target(true));
      listeners.get("keydown")?.(event);
      expect(run).toHaveBeenCalledOnce();
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
  });
  it("allows native context menu and text drag only in fields and code", () => {
    renderToString(createElement(Probe, { actions: [] }));
    for (const kind of ["contextmenu", "dragstart"]) {
      for (const target of [new Target(true), new Input()]) {
        const event = { target, preventDefault: vi.fn() };
        listeners.get(kind)?.(event);
        expect(event.preventDefault).not.toHaveBeenCalled();
      }
      const outside = { target: new Target(), preventDefault: vi.fn() };
      listeners.get(kind)?.(outside);
      expect(outside.preventDefault).toHaveBeenCalledOnce();
    }
  });
});
