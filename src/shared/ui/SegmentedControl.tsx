import type { LucideIcon } from "lucide-react";
import { ToggleGroup } from "radix-ui";

import styles from "./SegmentedControl.module.css";
import { Tooltip } from "./Tooltip";

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: string;
  /** Tooltip explaining the option. */
  hint?: string;
  icon?: LucideIcon;
}

interface SegmentedControlProps<Value extends string> {
  ariaLabel: string;
  value: Value;
  options: readonly SegmentedOption<Value>[];
  onValueChange: (value: Value) => void;
  disabled?: boolean;
}

export function SegmentedControl<Value extends string>({
  ariaLabel,
  value,
  options,
  onValueChange,
  disabled = false,
}: SegmentedControlProps<Value>) {
  const handleValueChange = (next: string) => {
    // Radix reports "" when the active item is clicked again; a segmented control keeps it.
    const option = options.find((candidate) => candidate.value === next);
    if (option) {
      onValueChange(option.value);
    }
  };

  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      disabled={disabled}
      onValueChange={handleValueChange}
      aria-label={ariaLabel}
      className={styles.root}
    >
      {options.map((option) => {
        const item = (
          <ToggleGroup.Item key={option.value} value={option.value} className={styles.item}>
            {option.icon ? <option.icon className={styles.icon} aria-hidden="true" /> : null}
            {option.label}
          </ToggleGroup.Item>
        );
        return option.hint ? (
          <Tooltip key={option.value} label={option.hint}>
            {item}
          </Tooltip>
        ) : (
          item
        );
      })}
    </ToggleGroup.Root>
  );
}
