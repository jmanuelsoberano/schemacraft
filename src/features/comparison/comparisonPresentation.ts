import type { ComparisonValue } from "@/shared/contracts";
import type { Translator } from "@/shared/i18n/useI18n";

import {
  dependencyTargetIdentityCounts,
  isDependencyTargetIdentityPath,
} from "./comparisonDependencyEvidence";

/** Technical paths retain exact member names, while their understood property names translate. */
export function comparisonPropertyLabel(path: readonly string[], t: Translator["t"]): string {
  if (isDependencyTargetIdentityPath(path)) return t("comparison.dependencyTargetIdentity");
  const labels: Record<string, string> = {
    columns: t("review.property.columns"),
    dataType: t("review.property.dataType"),
    nullability: t("review.property.nullability"),
    defaultExpression: t("review.property.defaultExpression"),
    identity: t("review.property.identity"),
    computed: t("review.property.computed"),
    primaryKey: t("review.primaryKey"),
    indexes: t("review.index"),
    onDelete: t("review.property.onDelete"),
    onUpdate: t("review.property.onUpdate"),
    enabled: t("review.property.enabled"),
    trusted: t("review.property.trust"),
    referencedTable: t("review.property.referencedTable"),
    definitionState: t("comparison.definitionState"),
    dependencies: t("comparison.dependencies"),
    postgresql: t("comparison.native"),
    routineBodyTracking: t("comparison.routineBodyTracking"),
  };
  return path
    .map((part, index) => (index === 1 && path.length > 2 ? part : (labels[part] ?? part)))
    .join(" / ");
}

export function comparisonValueLabel(
  value: ComparisonValue,
  t: Translator["t"],
  path: readonly string[] = [],
): string {
  if (value.value === null) return t(`comparison.status.${value.observation.status}`);
  if (isDependencyTargetIdentityPath(path)) {
    const counts = dependencyTargetIdentityCounts(value.value);
    return counts === null
      ? t("comparison.status.unknown")
      : t("comparison.dependencyUnidentifiedTargets", { count: counts.unidentifiedTargets });
  }
  try {
    const parsed: unknown = JSON.parse(value.value);
    if (typeof parsed === "string") {
      if (
        path.length === 3 &&
        path[0] === "postgresql" &&
        path[1] === "routine" &&
        path[2] === "routineBodyTracking" &&
        (parsed === "parsedSqlBody" || parsed === "signatureOnly" || parsed === "unknown")
      )
        return t(`module.native.tracking.${parsed}`);
      return parsed;
    }
    if (typeof parsed === "boolean") return t(parsed ? "review.value.yes" : "review.value.no");
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value.value;
  }
}
