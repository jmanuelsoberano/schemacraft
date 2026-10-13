import type { LucideIcon } from "lucide-react";

import type { MessageKey } from "@/shared/i18n/messages/en";

import type { Shortcut } from "./shortcut";

export type ActionId =
  | "project.connect"
  | "project.openProject"
  | "project.saveProject"
  | "project.refreshFromDatabase"
  | "diagram.autoLayout"
  | "diagram.export"
  | "view.toggleSidebar";

/**
 * A user-facing operation defined once and surfaced consistently by toolbars, menus, the
 * command palette and keyboard shortcuts, so labels and shortcuts can never drift apart.
 */
export interface AppAction {
  id: ActionId;
  labelKey: MessageKey;
  icon: LucideIcon;
  shortcut?: Shortcut;
  /** False while the feature behind the action has not shipped; the UI explains why. */
  isAvailable: boolean;
  run: () => void;
}

export type ActionsById = Readonly<Record<ActionId, AppAction>>;
