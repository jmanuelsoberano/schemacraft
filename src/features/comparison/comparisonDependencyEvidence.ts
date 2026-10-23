/** Endpoint uncertainty is a separate fact from confirmed changes in known references. */
export function isDependencyTargetIdentityPath(path: readonly string[]): boolean {
  return path.length === 2 && path[0] === "dependencies" && path[1] === "targetIdentity";
}

export interface DependencyTargetIdentityCounts {
  unidentifiedTargets: number;
}

/** Only a bounded count can cross this presentation/export boundary, never target identities. */
export function dependencyTargetIdentityCounts(
  value: string | null,
): DependencyTargetIdentityCounts | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      !("unidentifiedTargets" in parsed) ||
      typeof parsed.unidentifiedTargets !== "number" ||
      !Number.isSafeInteger(parsed.unidentifiedTargets) ||
      parsed.unidentifiedTargets < 0
    )
      return null;
    return { unidentifiedTargets: parsed.unidentifiedTargets };
  } catch {
    return null;
  }
}
