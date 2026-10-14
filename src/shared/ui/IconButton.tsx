import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";

import styles from "./IconButton.module.css";
import { Tooltip } from "./Tooltip";
import { classNames } from "./classNames";

interface IconButtonProps extends Omit<ComponentProps<"button">, "children" | "aria-label"> {
  /** Accessible name; also the tooltip text. */
  label: string;
  icon: LucideIcon;
  /** Secondary tooltip line, typically why the control is disabled. */
  description?: string;
  shortcutHint?: string;
  isActive?: boolean;
}

export function IconButton({
  label,
  icon: Icon,
  description,
  shortcutHint,
  isActive = false,
  className,
  type = "button",
  disabled = false,
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={isActive ? true : undefined}
      className={classNames(styles.iconButton, isActive && styles.active, className)}
      disabled={disabled}
      {...rest}
    >
      <Icon className={styles.icon} aria-hidden="true" />
    </button>
  );

  return (
    <Tooltip label={label} description={description} shortcutHint={shortcutHint}>
      {disabled ? <span className={styles.disabledWrapper}>{button}</span> : button}
    </Tooltip>
  );
}
