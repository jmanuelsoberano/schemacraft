import { ShieldHalf } from "lucide-react";

import { CopyScriptButton } from "@/features/access/CopyScriptButton";
import {
  describeAccessCause,
  grantHelps,
  partialReadOutcome,
  primaryCause,
} from "@/features/access/accessCause";
import { grantScript } from "@/features/access/grantScript";
import type { AccessProfile } from "@/shared/contracts";
import { useI18n } from "@/shared/i18n/useI18n";
import { Alert } from "@/shared/ui/Alert";

interface AccessCheckNoticeProps {
  access: AccessProfile;
  database: string;
  includeCode?: boolean;
}

/**
 * What the access check found for the chosen database, before or instead of reading it. Full
 * access adds nothing; partial access gets one polite line, an empty database a neutral note,
 * and a login that sees nothing a blocking notice with the GRANT that would fix it.
 */
export function AccessCheckNotice({
  access,
  database,
  includeCode = false,
}: AccessCheckNoticeProps) {
  const translator = useI18n();
  const { t, locale } = translator;
  const cause = primaryCause(access);
  const causeText = cause === null ? null : describeAccessCause(cause, translator);
  const codeGap =
    includeCode &&
    access.coverage.moduleDefinitions !== undefined &&
    access.coverage.moduleDefinitions !== "complete";
  const codeText = codeGap ? t("access.notice.code") : null;

  switch (access.level) {
    case "full":
      return codeGap ? (
        <Alert variant="info" title={t("access.report.moduleDefinitions")}>
          {codeText}
        </Alert>
      ) : null;
    case "partial":
      return (
        <Alert
          variant="info"
          icon={ShieldHalf}
          title={t("access.notice.partial.title", { database })}
        >
          {causeText} {t(`access.notice.partial.readAnyway.${partialReadOutcome(access)}`)}
          {codeGap ? <> {codeText}</> : null}
        </Alert>
      );
    case "empty":
      return (
        <Alert variant="info" title={t("access.notice.empty.title", { database })}>
          {t("access.notice.empty.description")}
        </Alert>
      );
    case "nothingVisible":
      return (
        <Alert
          variant="danger"
          title={t("access.none.title", { database })}
          action={
            grantHelps(access) ? (
              <CopyScriptButton
                script={grantScript({
                  database,
                  principal: access.probe?.databaseUser ?? null,
                  locale,
                })}
              />
            ) : null
          }
        >
          {causeText}
        </Alert>
      );
  }
}
