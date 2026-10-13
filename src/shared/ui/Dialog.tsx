import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { ReactNode, RefObject } from "react";

import styles from "./Dialog.module.css";
import { IconButton } from "./IconButton";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Accessible name of the close button. */
  closeLabel: string;
  /** False while an operation runs, so the dialog cannot be dismissed by accident. */
  isDismissable?: boolean;
  /** Element to focus when the dialog opens, instead of the first focusable one. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  isDismissable = true,
  initialFocusRef,
  width = 560,
  children,
  footer,
}: DialogProps) {
  const preventWhenLocked = (event: { preventDefault: () => void }) => {
    if (!isDismissable) {
      event.preventDefault();
    }
  };

  const focusInitialElement = (event: Event) => {
    const element = initialFocusRef?.current;
    if (element) {
      event.preventDefault();
      element.focus();
    }
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content
          className={styles.content}
          style={{ width }}
          onEscapeKeyDown={preventWhenLocked}
          onPointerDownOutside={preventWhenLocked}
          onInteractOutside={preventWhenLocked}
          onOpenAutoFocus={focusInitialElement}
          aria-describedby={description ? undefined : ""}
        >
          <header className={styles.header}>
            <div className={styles.heading}>
              <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className={styles.description}>
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label={closeLabel} icon={X} disabled={!isDismissable} />
            </RadixDialog.Close>
          </header>
          <div className={styles.body}>{children}</div>
          {footer ? <footer className={styles.footer}>{footer}</footer> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
