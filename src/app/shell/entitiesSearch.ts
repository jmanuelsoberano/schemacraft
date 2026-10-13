import { useSettingsStore } from "@/shared/settings/settingsStore";

/** Id of the search box of the entities panel, so the search action can reach it. */
export const ENTITIES_SEARCH_INPUT_ID = "entities-search-input";

/** Opens the entities panel if it is collapsed and puts the caret in its search box. */
export function focusEntitiesSearch(): void {
  useSettingsStore.getState().setSidebarOpen(true);
  // The panel leaves its inert state on the next render; focus once that has happened.
  window.setTimeout(() => {
    const input = document.getElementById(ENTITIES_SEARCH_INPUT_ID);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }, 0);
}
