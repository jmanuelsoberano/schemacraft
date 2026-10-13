import { Tooltip as RadixTooltip } from "radix-ui";
import type { ReactElement } from "react";

import { Kbd } from "./Kbd";
import styles from "./Tooltip.module.css";

interface TooltipProps {
  label: string;
  /** Secondary line, e.g. why a control is unavailable. */
  description?: string;
  /** Formatted keyboard shortcut shown next to the label. */
  shortcutHint?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}

export function Tooltip({
  label,
  description,
  shortcutHint,
  side = "bottom",
  children,
}: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={styles.content}
        >
          <span className={styles.row}>
            <span>{label}</span>
            {shortcutHint ? <Kbd inverse>{shortcutHint}</Kbd> : null}
          </span>
          {description ? <span className={styles.description}>{description}</span> : null}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
