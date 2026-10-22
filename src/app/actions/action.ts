import type { LucideIcon } from "lucide-react";

import type { MessageKey } from "@/shared/i18n/messages/en";

import type { Shortcut } from "./shortcut";

export type ActionId =
  | "project.connect"
  | "project.openProject"
  | "project.saveProject"
  | "project.saveProjectAs"
  | "project.refreshFromDatabase"
  | "diagram.autoLayout"
  | "diagram.layoutLayered"
  | "diagram.layoutLayeredHorizontal"
  | "diagram.layoutOrganic"
  | "diagram.layoutRadial"
  | "diagram.fitView"
  | "diagram.showAll"
  | "diagram.collapseAll"
  | "diagram.expandAll"
  | "diagram.export"
  | "diagram.exportPdf"
  | "edit.undo"
  | "edit.redo"
  | "view.commandPalette"
  | "view.toggleSidebar"
  | "view.toggleInspector"
  | "view.searchEntities"
  | "view.accessReport"
  | "view.detailCompact"
  | "view.detailKeys"
  | "view.detailFull"
  | "settings.theme.system"
  | "settings.theme.light"
  | "settings.theme.dark"
  | "settings.language.en"
  | "settings.language.es"
  | "help.about"
  | "help.reportProblem"
  | "help.openLogFolder";

/**
 * A user-facing operation defined once and surfaced consistently by toolbars, menus, the
 * command palette and keyboard shortcuts, so labels and shortcuts can never drift apart.
 */
export interface AppAction {
  id: ActionId;
  labelKey: MessageKey;
  icon: LucideIcon;
  shortcut?: Shortcut;
  /** False while the action cannot run right now, for example without an open project. */
  isAvailable: boolean;
  /** Why the action is unavailable, shown in its tooltip; set whenever `isAvailable` is false. */
  unavailableReason?: MessageKey;
  /** Leave the shortcut to the focused text field, e.g. undo inside the search box. */
  skipWhenEditing?: boolean;
  run: () => void;
}

export type ActionsById = Readonly<Record<ActionId, AppAction>>;
