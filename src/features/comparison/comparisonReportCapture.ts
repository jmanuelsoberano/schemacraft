import type { ComparisonCapture } from "@/shared/contracts";
import { formatDateTime } from "@/shared/i18n/formatDate";
import type { Translator } from "@/shared/i18n/useI18n";

import { comparisonFlagLabel, comparisonVisibilityLabel } from "./comparisonEvidence";

/** Report-only projection: no complete scope list, optional object family or extension data. */
export interface ReportCapture {
  provider: ComparisonCapture["provider"];
  extractedAt: string;
  accessLevel: ComparisonCapture["accessLevel"];
  hasUnknownExtensions: boolean;
  scope: {
    includedSchemas: string[];
    otherSelectedSchemaCount: number;
    allSchemasRequested: boolean;
    includeViews: boolean;
    includeProgrammability?: boolean;
    includeModuleDefinitions?: boolean;
  } | null;
}

/** Rebuild each permitted value before any capture context enters a shared document. */
export function projectReportCapture(
  capture: ComparisonCapture,
  includedSchemas: ReadonlySet<string>,
): ReportCapture {
  const scope = capture.scope;
  return {
    provider: capture.provider,
    extractedAt: capture.extractedAt,
    accessLevel: capture.accessLevel,
    hasUnknownExtensions: capture.hasUnknownExtensions,
    scope:
      scope === null
        ? null
        : {
            includedSchemas: scope.schemas.filter((schema) => includedSchemas.has(schema)),
            otherSelectedSchemaCount: scope.schemas.filter((schema) => !includedSchemas.has(schema))
              .length,
            allSchemasRequested: scope.schemas.length === 0,
            includeViews: scope.includeViews,
            ...(scope.includeProgrammability === undefined
              ? {}
              : { includeProgrammability: scope.includeProgrammability }),
            ...(scope.includeModuleDefinitions === undefined
              ? {}
              : { includeModuleDefinitions: scope.includeModuleDefinitions }),
          },
  };
}

/** The same visibility and missing-evidence words as the desktop, with a scoped schema summary. */
export function reportCaptureFields(
  capture: ReportCapture,
  translator: Translator,
): { label: string; value: string }[] {
  const { t, tCount, locale } = translator;
  const scope = capture.scope;
  const schemaDescription =
    scope === null
      ? t("comparison.status.notRecorded")
      : scope.allSchemasRequested
        ? t("comparison.capture.allSchemas")
        : [
            scope.includedSchemas.length === 0
              ? t("comparison.capture.noIncludedSchemas")
              : scope.includedSchemas.join(", "),
            ...(scope.otherSelectedSchemaCount === 0
              ? []
              : [tCount("comparison.capture.otherSchemas", scope.otherSelectedSchemaCount)]),
          ].join(" · ");
  return [
    { label: t("connection.field.provider"), value: t(`connection.provider.${capture.provider}`) },
    {
      label: t("comparison.capture.completedAt"),
      value: formatDateTime(capture.extractedAt, locale),
    },
    {
      label: t("comparison.capture.access"),
      value: comparisonVisibilityLabel(capture.accessLevel, translator),
    },
    { label: t("comparison.capture.schemas"), value: schemaDescription },
    {
      label: t("comparison.capture.views"),
      value: comparisonFlagLabel(scope?.includeViews, translator),
    },
    {
      label: t("comparison.capture.modulesRead"),
      value: comparisonFlagLabel(scope?.includeProgrammability, translator),
    },
    {
      label: t("comparison.capture.definitionsRead"),
      value: comparisonFlagLabel(scope?.includeModuleDefinitions, translator),
    },
  ];
}
