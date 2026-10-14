import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactElement } from "react";

import styles from "./RadioMenu.module.css";

export interface RadioMenuOption<Value extends string> {
  value: Value;
  label: string;
  icon?: LucideIcon;
}

interface RadioMenuProps<Value extends string> {
  /** Heading shown above the options. */
  label: string;
  value: Value;
  options: readonly RadioMenuOption<Value>[];
  onValueChange: (value: Value) => void;
  /** Element that opens the menu; it must forward props to a button. */
  trigger: ReactElement;
}

/** Dropdown menu with a single-choice list, used for preferences such as theme or language. */
export function RadioMenu<Value extends string>({
  label,
  value,
  options,
  onValueChange,
  trigger,
}: RadioMenuProps<Value>) {
  const handleValueChange = (next: string) => {
    const option = options.find((candidate) => candidate.value === next);
    if (option) {
      onValueChange(option.value);
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className={styles.content}
        >
          <DropdownMenu.Label className={styles.label}>{label}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value} onValueChange={handleValueChange}>
            {options.map((option) => (
              <DropdownMenu.RadioItem
                key={option.value}
                value={option.value}
                className={styles.item}
              >
                <DropdownMenu.ItemIndicator className={styles.indicator}>
                  <Check size={14} aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
                {option.icon ? <option.icon className={styles.icon} aria-hidden="true" /> : null}
                {option.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
