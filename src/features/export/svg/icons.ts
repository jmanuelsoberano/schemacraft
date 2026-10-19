/**
 * The Lucide icons the canvas shows, as SVG symbols. They are stroke-based 24-unit drawings;
 * the `<use>` element that places them sets the size and, through its class, the stroke colour.
 */
export const ICON_TABLE = "sc-icon-table";
export const ICON_VIEW = "sc-icon-view";
export const ICON_KEY = "sc-icon-key";
export const ICON_LINK = "sc-icon-link";
export const ICON_TRIGGER = "sc-icon-trigger";
export const ICON_TRIGGER_DISABLED = "sc-icon-trigger-disabled";

const STROKE_ATTRIBUTES =
  'fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

function symbol(id: string, body: string): string {
  return `<symbol id="${id}" viewBox="0 0 24 24" ${STROKE_ATTRIBUTES}>${body}</symbol>`;
}

/** Symbol definitions to place inside `<defs>`. */
export const ICON_SYMBOLS = [
  symbol(
    ICON_TABLE,
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 3v18"/>',
  ),
  // Lucide "glasses", the icon the canvas and the sidebar give a view.
  symbol(
    ICON_VIEW,
    '<circle cx="6" cy="15" r="4"/><circle cx="18" cy="15" r="4"/><path d="M14 15a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/><path d="M2.5 13 5 7c.7-1.3 1.4-2 3-2"/><path d="M21.5 13 19 7c-.7-1.3-1.5-2-3-2"/>',
  ),
  symbol(
    ICON_KEY,
    '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  ),
  symbol(
    ICON_LINK,
    '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
  ),
].join("");

/** Kept separate so diagrams without trigger badges retain their original symbol set. */
export const TRIGGER_ICON_SYMBOLS = [
  symbol(
    ICON_TRIGGER,
    '<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/>',
  ),
  symbol(
    ICON_TRIGGER_DISABLED,
    '<path d="M10.768 5.111 13.44 2.44a1.5 1.5 0 012.474 1.561l-1.633 4.625"/><path d="m18.889 13.232.672-.672A1.5 1.5 0 0018.5 10h-2.844"/><path d="m2 2 20 20"/><path d="m7.94 7.94-3.5 3.499A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l5.5-5.5"/>',
  ),
].join("");
