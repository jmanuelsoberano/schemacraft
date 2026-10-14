import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import styles from "./Button.module.css";
import { classNames } from "./classNames";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: LucideIcon;
  children: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
};

export function Button({
  variant = "secondary",
  size = "sm",
  leadingIcon: LeadingIcon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classNames(
        styles.button,
        VARIANT_CLASS[variant],
        size === "md" && styles.sizeMd,
        className,
      )}
      {...rest}
    >
      {LeadingIcon ? <LeadingIcon className={styles.icon} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
