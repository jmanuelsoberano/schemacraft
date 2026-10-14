import type { ReactNode } from "react";

import styles from "./Kbd.module.css";
import { classNames } from "./classNames";

interface KbdProps {
  children: ReactNode;
  /** Styles the key for dark tooltip backgrounds. */
  inverse?: boolean;
}

export function Kbd({ children, inverse = false }: KbdProps) {
  return <kbd className={classNames(styles.kbd, inverse && styles.inverse)}>{children}</kbd>;
}
