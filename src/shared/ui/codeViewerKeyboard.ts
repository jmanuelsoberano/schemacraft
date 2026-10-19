type CodeKeyboardEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

export type CodeViewerCommand = "find" | "selectAll" | "next" | "previous" | "closeFind";

export function codeViewerCommand(
  event: CodeKeyboardEvent,
  applePlatform: boolean,
  findOpen: boolean,
): CodeViewerCommand | null {
  if (event.altKey || (applePlatform ? event.ctrlKey : event.metaKey)) return null;
  const mod = applePlatform ? event.metaKey : event.ctrlKey;
  const key = event.key.toLowerCase();
  if (mod && !event.shiftKey && key === "f") return "find";
  if (mod && !event.shiftKey && key === "a") return "selectAll";
  if (!mod && key === "f3") return event.shiftKey ? "previous" : "next";
  if (!mod && !event.shiftKey && key === "escape" && findOpen) return "closeFind";
  return null;
}

/** Code is read-only, but its selection, find bar and native text actions own their region. */
export function codeViewerRegion(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest('[data-keyboard-owner="code"]') : null;
}

export function isCodeViewerTarget(target: EventTarget | null): boolean {
  return codeViewerRegion(target) !== null;
}

/** The viewer handles these before the window action registry or browser guards interfere. */
export function isOwnedByCodeViewer(
  event: CodeKeyboardEvent & { target: EventTarget | null },
  applePlatform: boolean,
): boolean {
  const region = codeViewerRegion(event.target);
  if (region === null) return false;
  return (
    codeViewerCommand(event, applePlatform, region.getAttribute("data-find-open") === "true") !==
    null
  );
}
