import type { ComponentProps } from "react";

import type { MessageKey } from "@/shared/i18n/messages/en";
import { useI18n } from "@/shared/i18n/useI18n";
import { Button } from "@/shared/ui/Button";
import { Tooltip } from "@/shared/ui/Tooltip";

import type { AppAction } from "./action";
import styles from "./ActionButton.module.css";
import { formatShortcut, isApplePlatform } from "./shortcut";

interface ActionButtonProps extends Pick<ComponentProps<typeof Button>, "variant" | "size"> {
  action: AppAction;
  /** Overrides the action label, e.g. a shorter caption for a crowded toolbar. */
  labelKey?: MessageKey;
}

/** Labelled button for an action, with its shortcut in the tooltip and a reason when disabled. */
export function ActionButton({ action, labelKey, variant, size }: ActionButtonProps) {
  const { t } = useI18n();
  const shortcutHint = action.shortcut
    ? formatShortcut(action.shortcut, isApplePlatform())
    : undefined;

  const button = (
    <Button
      variant={variant}
      size={size}
      leadingIcon={action.icon}
      disabled={!action.isAvailable}
      onClick={action.run}
    >
      {t(labelKey ?? action.labelKey)}
    </Button>
  );

  if (action.isAvailable && shortcutHint === undefined) {
    return button;
  }

  return (
    <Tooltip
      label={t(action.labelKey)}
      description={
        action.isAvailable || action.unavailableReason === undefined
          ? undefined
          : t(action.unavailableReason)
      }
      shortcutHint={shortcutHint}
    >
      {action.isAvailable ? button : <span className={styles.disabledWrapper}>{button}</span>}
    </Tooltip>
  );
}
