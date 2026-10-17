import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "@/shared/i18n/useI18n";
import { Button } from "@/shared/ui/Button";

import styles from "./CopyScriptButton.module.css";

type CopyOutcome = "idle" | "copied" | "failed";

/** How long the confirmation stays next to the button. */
const FEEDBACK_MILLISECONDS = 2500;

interface CopyScriptButtonProps {
  script: string;
  variant?: "primary" | "secondary";
}

/**
 * Copies the GRANT script to the clipboard; SchemaCraft never runs it. The outcome is shown next
 * to the button and announced politely, so the user knows the copy worked without moving focus.
 */
export function CopyScriptButton({ script, variant = "secondary" }: CopyScriptButtonProps) {
  const { t } = useI18n();
  const [outcome, setOutcome] = useState<CopyOutcome>("idle");

  useEffect(() => {
    if (outcome === "idle") {
      return;
    }
    const timer = window.setTimeout(() => {
      setOutcome("idle");
    }, FEEDBACK_MILLISECONDS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [outcome]);

  const copy = () => {
    navigator.clipboard.writeText(script).then(
      () => {
        setOutcome("copied");
      },
      (error: unknown) => {
        console.warn("Could not copy the GRANT script", error);
        setOutcome("failed");
      },
    );
  };

  return (
    <span className={styles.copy}>
      <Button variant={variant} leadingIcon={outcome === "copied" ? Check : Copy} onClick={copy}>
        {t("access.action.copyGrant")}
      </Button>
      <span className={styles.feedback} role="status">
        {outcome === "copied"
          ? t("access.action.copied")
          : outcome === "failed"
            ? t("access.action.copyFailed")
            : null}
      </span>
    </span>
  );
}
