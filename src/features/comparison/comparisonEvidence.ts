import type {
  AccessLevel,
  CaptureState,
  ComparisonCapture,
  SchemaSnapshot,
} from "@/shared/contracts";
import { formatDateTime } from "@/shared/i18n/formatDate";
import type { Translator } from "@/shared/i18n/useI18n";

function captureOutcome(state: CaptureState | undefined, { t }: Translator): string {
  if (state === undefined) return t("comparison.status.notRecorded");
  if (state.status === "notRead") return t(`dependencies.reason.${state.reason}`);
  return t(state.status === "read" ? "dependencies.status.read" : "comparison.status.unknown");
}

/** Missing evidence is distinct from a recorded negative answer in every renderer. */
export function comparisonFlagLabel(value: boolean | undefined, { t }: Translator): string {
  return value === undefined
    ? t("comparison.status.notRecorded")
    : t(value ? "review.value.yes" : "review.value.no");
}

export function comparisonVisibilityLabel(
  level: AccessLevel | null | undefined,
  { t }: Translator,
): string {
  return level == null
    ? t("comparison.status.notRecorded")
    : t(`comparison.capture.access.${level}`);
}

/** Captured evidence only; options do not imply that any optional family was actually read. */
export function comparisonCaptureFields(
  snapshot: SchemaSnapshot,
  capture: ComparisonCapture | undefined,
  translator: Translator,
): { label: string; value: string }[] {
  const { t, locale } = translator;
  const scope = capture?.scope ?? snapshot.access?.scope;
  const coverage = snapshot.access?.coverage;
  const accessLevel = capture?.accessLevel ?? snapshot.access?.level;
  const completeness = (value: "complete" | "partial" | "notAvailable" | undefined) =>
    value === undefined ? t("comparison.status.notRecorded") : t(`dependencies.status.${value}`);
  const optional = (
    state: CaptureState | undefined,
    value: "complete" | "partial" | "notAvailable" | undefined,
  ) =>
    state?.status === "read"
      ? `${captureOutcome(state, translator)} · ${completeness(value)}`
      : captureOutcome(state, translator);
  const dates = [
    ...(snapshot.carriedOver ?? []).map((item) => item.readAt),
    ...(snapshot.programmability?.carriedOver ?? []).map((item) => item.readAt),
    ...(snapshot.dependencies?.sources ?? [])
      .filter((source) => source.retained)
      .map((source) => source.readAt),
  ];
  return [
    {
      label: t("comparison.capture.access"),
      value: comparisonVisibilityLabel(accessLevel, translator),
    },
    {
      label: t("comparison.capture.schemas"),
      value:
        scope === undefined
          ? t("comparison.status.notRecorded")
          : scope.schemas.length === 0
            ? t("comparison.capture.allSchemas")
            : scope.schemas.join(", "),
    },
    {
      label: t("comparison.capture.views"),
      value: comparisonFlagLabel(scope?.includeViews, translator),
    },
    { label: t("comparison.capture.objects"), value: completeness(coverage?.objects) },
    { label: t("comparison.capture.expressions"), value: completeness(coverage?.definitions) },
    {
      label: t("comparison.capture.modules"),
      value: optional(snapshot.programmability?.capture.objects, coverage?.programmability),
    },
    {
      label: t("comparison.capture.definitions"),
      value: optional(snapshot.programmability?.capture.definitions, coverage?.moduleDefinitions),
    },
    {
      label: t("comparison.dependencies"),
      value: captureOutcome(snapshot.dependencies?.capture, translator),
    },
    ...(dates.length === 0
      ? []
      : [
          {
            label: t("comparison.status.retained"),
            value: [...new Set(dates)]
              .sort()
              .map((date) => formatDateTime(date, locale))
              .join(" · "),
          },
        ]),
  ];
}
