import type { InspectionStage } from "@/shared/contracts";

import type { StageProgress } from "./connectionStore";

/** Stages that have a row in the progress panel. */
export type DisplayedStage = Exclude<InspectionStage, "completed">;

/** Stages shown to the user, in the order they are listed. `completed` is not displayed. */
export const DISPLAYED_STAGES: readonly DisplayedStage[] = [
  "connecting",
  "readingObjects",
  "readingColumns",
  "readingIndexes",
  "readingForeignKeys",
  "readingConstraints",
  "assembling",
];

const CATALOG_STAGES: readonly InspectionStage[] = [
  "readingObjects",
  "readingColumns",
  "readingIndexes",
  "readingForeignKeys",
  "readingConstraints",
];

export type StageStatus = "pending" | "active" | "done";

/**
 * Derives what to show for a stage. The backend reports `connecting` and `assembling` when they
 * start and every catalog stage when it finishes, so completion is inferred from later stages.
 */
export function stageStatus(progress: StageProgress, stage: InspectionStage): StageStatus {
  const reported = (candidate: InspectionStage) => progress[candidate] !== undefined;
  const catalogStarted =
    CATALOG_STAGES.some(reported) || reported("assembling") || reported("completed");

  switch (stage) {
    case "connecting":
      if (catalogStarted) return "done";
      return reported("connecting") ? "active" : "pending";
    case "assembling":
      if (reported("completed")) return "done";
      return reported("assembling") ? "active" : "pending";
    case "completed":
      return reported("completed") ? "done" : "pending";
    case "readingObjects":
    case "readingColumns":
    case "readingIndexes":
    case "readingForeignKeys":
    case "readingConstraints":
      if (reported(stage)) return "done";
      return reported("connecting") || catalogStarted ? "active" : "pending";
  }
}
