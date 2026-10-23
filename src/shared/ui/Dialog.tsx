import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { useRef } from "react";
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
  /**
   * Element to focus when the dialog opens. Without one the dialog itself takes focus, so no
   * control's tooltip pops open before the user acts and Escape closes the dialog right away.
   */
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

  const contentRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const focusInitialElement = (event: Event) => {
    event.preventDefault();
    const ownerDocument = contentRef.current?.ownerDocument;
    const opener = ownerDocument?.activeElement;
    openerRef.current =
      opener instanceof HTMLElement && opener !== ownerDocument?.body ? opener : null;
    (initialFocusRef?.current ?? contentRef.current)?.focus();
  };
  const restoreOpenerFocus = (event: Event) => {
    // These controlled dialogs have no Radix Trigger. Each scope restores its own opener,
    // including a button in a parent dialog; a removed menu item has no global substitute.
    event.preventDefault();
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content
          ref={contentRef}
          tabIndex={-1}
          className={styles.content}
          style={{ width }}
          onEscapeKeyDown={preventWhenLocked}
          onPointerDownOutside={preventWhenLocked}
          onInteractOutside={preventWhenLocked}
          onOpenAutoFocus={focusInitialElement}
          onCloseAutoFocus={restoreOpenerFocus}
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
