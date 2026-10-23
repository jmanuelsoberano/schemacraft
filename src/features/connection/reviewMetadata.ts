import type { RefreshMetadataDiff } from "@/shared/contracts";

/** Presentation inventory only: the Rust diff owns change and up-to-date verdicts. */
export function hasMetadataReview(metadata: RefreshMetadataDiff | undefined): boolean {
  if (!metadata) return false;
  const dependencies = metadata.dependencies;
  return (
    dependencies.changes.length > 0 ||
    dependencies.newlyRecorded ||
    dependencies.newlyAvailableSources > 0 ||
    dependencies.excluded ||
    dependencies.scopeChanged ||
    dependencies.captureChanged ||
    dependencies.notChecked.length > 0 ||
    dependencies.readFailure !== null ||
    metadata.nativeChanges.length > 0 ||
    metadata.nativeNotChecked.length > 0 ||
    metadata.nativeRecorded
  );
}
