import type { RoutineDependencyTracking } from "@/shared/contracts/generated/model/RoutineDependencyTracking";
import type { MessageKey } from "@/shared/i18n/messages/en";
import type { CatalogTranslator } from "@/shared/i18n/translator";

export type RoutineTrackingState = RoutineDependencyTracking | "notRecorded";
export const ROUTINE_TRACKING_STATES = [
  "parsedSqlBody",
  "signatureOnly",
  "unknown",
  "notRecorded",
] as const;
type TrackingTranslator = CatalogTranslator<
  Extract<MessageKey, `module.native.tracking.${string}`>
>;

export interface RoutineTrackingView {
  state: RoutineTrackingState;
  title: string;
  label: string;
  explanation: string;
}

/** Catalog tracking evidence is independent of storing source and of runtime completeness. */
export function presentRoutineDependencyTracking(
  tracking: RoutineTrackingState | undefined,
  { t }: TrackingTranslator,
): RoutineTrackingView {
  const state = tracking ?? "notRecorded";
  return {
    state,
    title: t("module.native.tracking.title"),
    label: t(`module.native.tracking.${state}`),
    explanation: t(`module.native.tracking.${state}.hint`),
  };
}
