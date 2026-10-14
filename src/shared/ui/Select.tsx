import { Check, ChevronDown } from "lucide-react";
import { Select as RadixSelect } from "radix-ui";
import { useId } from "react";

import styles from "./Select.module.css";

export interface SelectOption<Value extends string> {
  value: Value;
  label: string;
}

interface SelectProps<Value extends string> {
  label: string;
  value: Value | undefined;
  options: readonly SelectOption<Value>[];
  onValueChange: (value: Value) => void;
  placeholder: string;
  hint?: string;
  disabled?: boolean;
}

export function Select<Value extends string>({
  label,
  value,
  options,
  onValueChange,
  placeholder,
  hint,
  disabled = false,
}: SelectProps<Value>) {
  const labelId = useId();

  const handleValueChange = (next: string) => {
    const option = options.find((candidate) => candidate.value === next);
    if (option) {
      onValueChange(option.value);
    }
  };

  return (
    <div className={styles.field}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <RadixSelect.Root value={value} onValueChange={handleValueChange} disabled={disabled}>
        <RadixSelect.Trigger className={styles.trigger} aria-labelledby={labelId}>
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon className={styles.icon}>
            <ChevronDown size={14} aria-hidden="true" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content className={styles.content} position="popper" sideOffset={4}>
            <RadixSelect.Viewport className={styles.viewport}>
              {options.map((option) => (
                <RadixSelect.Item key={option.value} value={option.value} className={styles.item}>
                  <RadixSelect.ItemIndicator className={styles.indicator}>
                    <Check size={14} aria-hidden="true" />
                  </RadixSelect.ItemIndicator>
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  );
}
