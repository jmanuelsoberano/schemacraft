import { useI18n } from "@/shared/i18n/useI18n";
import { IconButton } from "@/shared/ui/IconButton";

import type { AppAction } from "./action";
import { formatShortcut, isApplePlatform } from "./shortcut";

interface ActionIconButtonProps {
  action: AppAction;
  isActive?: boolean;
}

/** Toolbar button for an action: icon, tooltip with label and shortcut, disabled state. */
export function ActionIconButton({ action, isActive }: ActionIconButtonProps) {
  const { t } = useI18n();

  return (
    <IconButton
      label={t(action.labelKey)}
      icon={action.icon}
      shortcutHint={
        action.shortcut ? formatShortcut(action.shortcut, isApplePlatform()) : undefined
      }
      description={
        action.isAvailable || action.unavailableReason === undefined
          ? undefined
          : t(action.unavailableReason)
      }
      disabled={!action.isAvailable}
      isActive={isActive}
      onClick={action.run}
    />
  );
}
