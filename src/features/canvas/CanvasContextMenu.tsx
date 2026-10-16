import {
  ChevronsDownUp,
  ChevronsUpDown,
  Crosshair,
  EyeOff,
  Focus,
  Layers,
  ScanSearch,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DropdownMenu } from "radix-ui";

import { useProjectStore } from "@/features/project/projectStore";
import type { MessageKey } from "@/shared/i18n/messages/en";
import { useI18n } from "@/shared/i18n/useI18n";
import { Kbd } from "@/shared/ui/Kbd";
import menuStyles from "@/shared/ui/RadioMenu.module.css";

import { isolateEntity, setCollapsed, setHidden } from "./canvasActions";
import { nodeStateFor } from "./canvasState";
import { useCanvasUiStore } from "./canvasUiStore";

/**
 * What the menu needs of a registry action. The registry lives in the app layer, which the
 * features never import, so the shell hands the action over in this shape.
 */
export interface ContextMenuCommand {
  labelKey: MessageKey;
  isAvailable: boolean;
  /** Formatted shortcut, shown next to the label. */
  shortcutHint?: string;
  run: () => void;
}

interface CanvasContextMenuProps {
  /** The registry's "show all entities" action, so the menu and the shortcut cannot drift. */
  showAll: ContextMenuCommand;
}

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  shortcutHint?: string;
}

function MenuItem({ icon: Icon, label, onSelect, disabled = false, shortcutHint }: MenuItemProps) {
  return (
    <DropdownMenu.Item className={menuStyles.item} disabled={disabled} onSelect={onSelect}>
      <span className={menuStyles.indicator} />
      <Icon className={menuStyles.icon} aria-hidden="true" />
      {label}
      {shortcutHint ? <Kbd>{shortcutHint}</Kbd> : null}
    </DropdownMenu.Item>
  );
}

/**
 * Right-click menu of an entity, on the canvas or in the sidebar: centre, hide, isolate with its
 * relationships, collapse or expand, and show everything again. The entity-scoped commands go
 * through canvasActions; "show all" runs the registry action the shell passes in.
 */
export function CanvasContextMenu({ showAll }: CanvasContextMenuProps) {
  const { t } = useI18n();
  const menu = useCanvasUiStore((state) => state.contextMenu);
  const closeContextMenu = useCanvasUiStore((state) => state.closeContextMenu);
  const focusEntity = useCanvasUiStore((state) => state.focusEntity);
  const canvas = useProjectStore((state) => state.project?.content.canvas ?? null);

  const key = menu?.key ?? null;
  const nodeState = key !== null && canvas !== null ? nodeStateFor(canvas, key) : undefined;
  const isCollapsed = nodeState?.isCollapsed ?? false;

  return (
    <DropdownMenu.Root
      open={menu !== null}
      onOpenChange={(open) => {
        if (!open) {
          closeContextMenu();
        }
      }}
    >
      <DropdownMenu.Trigger asChild>
        <span
          aria-hidden="true"
          style={{ position: "fixed", left: menu?.x ?? 0, top: menu?.y ?? 0, width: 0, height: 0 }}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={2}
          collisionPadding={8}
          className={menuStyles.content}
        >
          {key !== null ? (
            <>
              <DropdownMenu.Label className={menuStyles.label}>{key}</DropdownMenu.Label>
              <MenuItem
                icon={Crosshair}
                label={t("canvas.menu.center")}
                onSelect={() => {
                  focusEntity(key);
                }}
              />
              <MenuItem
                icon={isCollapsed ? ChevronsUpDown : ChevronsDownUp}
                label={isCollapsed ? t("canvas.node.expand") : t("canvas.node.collapse")}
                onSelect={() => {
                  setCollapsed([key], !isCollapsed);
                }}
              />
              <MenuItem
                icon={Focus}
                label={t("canvas.menu.isolateOne")}
                onSelect={() => {
                  isolateEntity(key, 1);
                }}
              />
              <MenuItem
                icon={ScanSearch}
                label={t("canvas.menu.isolateTwo")}
                onSelect={() => {
                  isolateEntity(key, 2);
                }}
              />
              <MenuItem
                icon={EyeOff}
                label={t("canvas.menu.hide")}
                onSelect={() => {
                  setHidden([key], true);
                }}
              />
            </>
          ) : null}
          <MenuItem
            icon={Layers}
            label={t(showAll.labelKey)}
            shortcutHint={showAll.shortcutHint}
            disabled={!showAll.isAvailable}
            onSelect={showAll.run}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
