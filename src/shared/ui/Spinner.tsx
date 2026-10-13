import styles from "./Spinner.module.css";

interface SpinnerProps {
  size?: number;
}

/** Indeterminate activity indicator. Decorative; pair it with visible text. */
export function Spinner({ size = 16 }: SpinnerProps) {
  return (
    <span className={styles.spinner} style={{ width: size, height: size }} aria-hidden="true" />
  );
}
