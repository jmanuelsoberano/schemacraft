import styles from "./ProgressBar.module.css";
import { classNames } from "./classNames";

interface ProgressBarProps {
  /** Completion from 0 to 100; omit for an indeterminate bar. */
  value?: number;
  label: string;
}

export function ProgressBar({ value, label }: ProgressBarProps) {
  const isIndeterminate = value === undefined;
  const clamped = isIndeterminate ? undefined : Math.min(100, Math.max(0, value));

  return (
    <div
      className={classNames(styles.track, isIndeterminate && styles.indeterminate)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
    >
      <div
        className={styles.fill}
        style={clamped === undefined ? undefined : { width: `${clamped}%` }}
      />
    </div>
  );
}
