import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import styles from "./Alert.module.css";
import { IconButton } from "./IconButton";
import { classNames } from "./classNames";

type AlertVariant = "info" | "success" | "warning" | "danger";

type AlertDismissal =
  | { onDismiss?: undefined; dismissLabel?: undefined }
  | {
      /** Shows a close button; the alert itself decides nothing and the caller removes it. */
      onDismiss: () => void;
      /** Accessible name and tooltip of the close button. */
      dismissLabel: string;
    };

type AlertProps = AlertDismissal & {
  variant: AlertVariant;
  title: string;
  children?: ReactNode;
  /** Secondary technical detail, rendered in a monospaced block. */
  detail?: string;
  /** Call to action, e.g. a retry button. */
  action?: ReactNode;
  /** Replaces the variant's icon, e.g. a shield for access notices. */
  icon?: LucideIcon;
  /**
   * `polite` announces the alert as a status even for a warning: for notices that inform about
   * a state rather than report a failure, and must not interrupt a screen reader.
   */
  live?: "polite";
};

const VARIANT_ICON: Record<AlertVariant, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

const VARIANT_CLASS: Record<AlertVariant, string | undefined> = {
  info: styles.info,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
};

export function Alert({
  variant,
  title,
  children,
  detail,
  action,
  icon,
  live,
  onDismiss,
  dismissLabel,
}: AlertProps) {
  const Icon = icon ?? VARIANT_ICON[variant];
  const interrupts = live !== "polite" && (variant === "danger" || variant === "warning");

  return (
    <div
      className={classNames(styles.alert, VARIANT_CLASS[variant])}
      role={interrupts ? "alert" : "status"}
    >
      <Icon className={styles.icon} aria-hidden="true" />
      <div className={styles.content}>
        <div className={styles.title}>{title}</div>
        {children ? <div className={styles.message}>{children}</div> : null}
        {detail ? <pre className={styles.detail}>{detail}</pre> : null}
        {action ? <div className={styles.action}>{action}</div> : null}
      </div>
      {onDismiss ? (
        <IconButton className={styles.dismiss} label={dismissLabel} icon={X} onClick={onDismiss} />
      ) : null}
    </div>
  );
}
