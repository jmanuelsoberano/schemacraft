import type { ComponentProps } from "react";
import { useId } from "react";

import styles from "./TextField.module.css";
import { classNames } from "./classNames";

interface TextFieldProps extends Omit<ComponentProps<"input">, "id" | "aria-describedby"> {
  label: string;
  /** Guidance shown under the field while there is no error. */
  hint?: string;
  /** Validation message; replaces the hint and marks the field invalid. */
  error?: string;
}

export function TextField({ label, hint, error, className, ...inputProps }: TextFieldProps) {
  const inputId = useId();
  const messageId = useId();
  const message = error ?? hint;

  return (
    <div className={classNames(styles.field, className)}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <input
        id={inputId}
        className={classNames(styles.input, error !== undefined && styles.invalid)}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        {...inputProps}
      />
      {message ? (
        <span
          id={messageId}
          className={error !== undefined ? styles.error : styles.hint}
          role={error !== undefined ? "alert" : undefined}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
