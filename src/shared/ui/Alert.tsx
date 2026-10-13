import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import styles from "./Alert.module.css";
import { classNames } from "./classNames";

type AlertVariant = "info" | "success" | "warning" | "danger";

interface AlertProps {
  variant: AlertVariant;
  title: string;
  children?: ReactNode;
  /** Secondary technical detail, rendered in a monospaced block. */
  detail?: string;
  /** Call to action, e.g. a retry button. */
  action?: ReactNode;
}

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

export function Alert({ variant, title, children, detail, action }: AlertProps) {
  const Icon = VARIANT_ICON[variant];

  return (
    <div
      className={classNames(styles.alert, VARIANT_CLASS[variant])}
      role={variant === "danger" || variant === "warning" ? "alert" : "status"}
    >
      <Icon className={styles.icon} aria-hidden="true" />
      <div className={styles.content}>
        <div className={styles.title}>{title}</div>
        {children ? <div className={styles.message}>{children}</div> : null}
        {detail ? <pre className={styles.detail}>{detail}</pre> : null}
        {action ? <div className={styles.action}>{action}</div> : null}
      </div>
    </div>
  );
}
