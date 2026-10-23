import { createElement } from "react";
import type { ReactNode, RefObject } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Tooltip as RadixTooltip } from "radix-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FocusCallbacks {
  onOpenAutoFocus: (event: Event) => void;
  onCloseAutoFocus: (event: Event) => void;
}

const boundary = vi.hoisted((): { content: unknown; callbacks: unknown } => ({
  content: null,
  callbacks: null,
}));

vi.mock("radix-ui", async (original) => {
  const actual = await original<Record<string, unknown>>();
  const Pass = ({ children }: { children?: ReactNode }) => children;
  return {
    ...actual,
    Dialog: {
      Root: Pass,
      Portal: Pass,
      Overlay: () => null,
      Content: (props: FocusCallbacks & { ref: RefObject<unknown>; children: ReactNode }) => {
        props.ref.current = boundary.content;
        boundary.callbacks = props;
        return props.children;
      },
      Title: Pass,
      Description: Pass,
      Close: Pass,
    },
  };
});

const { Dialog } = await import("./Dialog");

class FocusElement {
  isConnected = true;
  readonly ownerDocument: FocusDocument;
  readonly focus = vi.fn<(options?: FocusOptions) => void>(() => {
    this.ownerDocument.activeElement = this;
  });
  constructor(ownerDocument: FocusDocument) {
    this.ownerDocument = ownerDocument;
  }
}

class FocusDocument {
  readonly body = new FocusElement(this);
  activeElement = this.body;
}

beforeEach(() => {
  vi.stubGlobal("HTMLElement", FocusElement);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderDialog(document: FocusDocument, initialFocus?: FocusElement) {
  const content = new FocusElement(document);
  boundary.content = content;
  renderToStaticMarkup(
    createElement(
      RadixTooltip.Provider,
      null,
      createElement(Dialog, {
        open: true,
        onOpenChange: () => undefined,
        title: "Review",
        closeLabel: "Close",
        children: "Read-only content",
        ...(initialFocus === undefined
          ? {}
          : { initialFocusRef: { current: initialFocus as unknown as HTMLElement } }),
      }),
    ),
  );
  const callbacks = boundary.callbacks as FocusCallbacks;
  return { content, ...callbacks };
}

describe("controlled dialog focus ownership", () => {
  it("captures the opener before initial focus and returns without scrolling", () => {
    const document = new FocusDocument();
    const opener = new FocusElement(document);
    const initial = new FocusElement(document);
    document.activeElement = opener;
    const dialog = renderDialog(document, initial);
    const open = new Event("open", { cancelable: true });
    dialog.onOpenAutoFocus(open);
    expect(open.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(initial);
    dialog.onCloseAutoFocus(new Event("close"));
    expect(opener.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(document.activeElement).toBe(opener);
    expect(document.body.focus).not.toHaveBeenCalled();
  });

  it("returns a nested dialog to its parent button, then the parent to its own opener", () => {
    const document = new FocusDocument();
    const toolbar = new FocusElement(document);
    document.activeElement = toolbar;
    const parent = renderDialog(document);
    parent.onOpenAutoFocus(new Event("open"));
    expect(document.activeElement).toBe(parent.content);

    const createButton = new FocusElement(document);
    document.activeElement = createButton;
    const nested = renderDialog(document);
    nested.onOpenAutoFocus(new Event("open"));
    expect(document.activeElement).toBe(nested.content);
    nested.content.isConnected = false;
    nested.onCloseAutoFocus(new Event("close"));
    expect(document.activeElement).toBe(createButton);
    expect(toolbar.focus).not.toHaveBeenCalled();
    parent.onCloseAutoFocus(new Event("close"));
    expect(document.activeElement).toBe(toolbar);
  });

  it("does not select an unrelated fallback when the opener is body or has disappeared", () => {
    const document = new FocusDocument();
    const bodyOpened = renderDialog(document);
    bodyOpened.onOpenAutoFocus(new Event("open"));
    document.activeElement = document.body;
    const bodyClose = new Event("close", { cancelable: true });
    bodyOpened.onCloseAutoFocus(bodyClose);
    expect(bodyClose.defaultPrevented).toBe(true);
    expect(document.body.focus).not.toHaveBeenCalled();

    const menuItem = new FocusElement(document);
    document.activeElement = menuItem;
    const menuOpened = renderDialog(document);
    menuOpened.onOpenAutoFocus(new Event("open"));
    menuItem.isConnected = false;
    document.activeElement = document.body;
    menuOpened.onCloseAutoFocus(new Event("close"));
    expect(menuItem.focus).not.toHaveBeenCalled();
    expect(document.body.focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("clears the old opener when the same dialog opens again from body", () => {
    const document = new FocusDocument();
    const opener = new FocusElement(document);
    document.activeElement = opener;
    const dialog = renderDialog(document);
    dialog.onOpenAutoFocus(new Event("open"));
    dialog.onCloseAutoFocus(new Event("close"));
    opener.focus.mockClear();

    document.activeElement = document.body;
    dialog.onOpenAutoFocus(new Event("open"));
    dialog.onCloseAutoFocus(new Event("close"));
    expect(opener.focus).not.toHaveBeenCalled();
    expect(document.body.focus).not.toHaveBeenCalled();
  });
});
