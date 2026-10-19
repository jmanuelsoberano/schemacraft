import { useI18n } from "@/shared/i18n/useI18n";
import { CopyButton } from "@/shared/ui/CopyButton";

interface CopyScriptButtonProps {
  script: string;
  variant?: "primary" | "secondary";
}

/** Copies the GRANT script; SchemaCraft never runs it. */
export function CopyScriptButton({ script, variant = "secondary" }: CopyScriptButtonProps) {
  const { t } = useI18n();
  return (
    <CopyButton
      text={script}
      label={t("access.action.copyGrant")}
      copiedLabel={t("copy.copied")}
      failedLabel={t("copy.failed")}
      variant={variant}
    />
  );
}
