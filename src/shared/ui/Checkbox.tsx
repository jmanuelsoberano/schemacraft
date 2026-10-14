import { Check } from "lucide-react";
import { Checkbox as RadixCheckbox } from "radix-ui";
import { useId } from "react";

import styles from "./Checkbox.module.css";

interface CheckboxProps {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Checkbox({
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
}: CheckboxProps) {
  const id = useId();

  return (
    <div className={styles.row}>
      <RadixCheckbox.Root
        id={id}
        className={styles.box}
        checked={checked}
        onCheckedChange={(next) => {
          onCheckedChange(next === true);
        }}
        disabled={disabled}
      >
        <RadixCheckbox.Indicator className={styles.indicator}>
          <Check size={12} strokeWidth={3} aria-hidden="true" />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <label htmlFor={id} className={styles.text}>
        <span className={styles.label}>{label}</span>
        {description ? <span className={styles.description}>{description}</span> : null}
      </label>
    </div>
  );
}
