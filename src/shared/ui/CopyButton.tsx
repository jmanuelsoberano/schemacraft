import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "./Button";
import { IconButton } from "./IconButton";
import styles from "./CopyButton.module.css";
import { copyText } from "./copy";
import type { CopyOutcome } from "./copy";

interface CopyButtonProps {
  text: string;
  label: string;
  copiedLabel: string;
  failedLabel: string;
  iconOnly?: boolean;
  variant?: "primary" | "secondary" | "ghost";
}

/** One copy interaction for code, rules and permission scripts, with polite status feedback. */
export function CopyButton({
  text,
  label,
  copiedLabel,
  failedLabel,
  iconOnly = false,
  variant = "secondary",
}: CopyButtonProps) {
  const [outcome, setOutcome] = useState<CopyOutcome>("idle");
  useEffect(() => {
    if (outcome === "idle") return;
    const timer = window.setTimeout(() => {
      setOutcome("idle");
    }, 2500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [outcome]);
  const copy = () => {
    void copyText(text).then(setOutcome);
  };
  const icon = outcome === "copied" ? Check : Copy;
  return (
    <span className={styles.copy}>
      {iconOnly ? (
        <IconButton label={label} icon={icon} className={styles.iconButton} onClick={copy} />
      ) : (
        <Button variant={variant} leadingIcon={icon} onClick={copy}>
          {label}
        </Button>
      )}
      <span className={styles.feedback} role="status">
        {outcome === "copied" ? copiedLabel : outcome === "failed" ? failedLabel : null}
      </span>
    </span>
  );
}
