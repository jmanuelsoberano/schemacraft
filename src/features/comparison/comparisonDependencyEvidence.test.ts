import { describe, expect, it } from "vitest";

import {
  dependencyTargetIdentityCounts,
  isDependencyTargetIdentityPath,
} from "./comparisonDependencyEvidence";

describe("dependency target identity evidence", () => {
  it("recognizes only the declared uncertainty path", () => {
    expect(isDependencyTargetIdentityPath(["dependencies", "targetIdentity"])).toBe(true);
    for (const path of [
      ["dependencies"],
      ["targetIdentity"],
      ["dependencies", "private", "targetIdentity"],
      ["dependencies", "targetIdentity", "source"],
    ])
      expect(isDependencyTargetIdentityPath(path)).toBe(false);
  });

  it("reconstructs only the nonnegative safe count, discarding target details", () => {
    expect(
      dependencyTargetIdentityCounts(
        JSON.stringify({
          unidentifiedTargets: 2,
          target: { server: "PRIVATE_HOST", name: "PRIVATE_TARGET" },
          source: "PRIVATE_SOURCE",
        }),
      ),
    ).toEqual({ unidentifiedTargets: 2 });
    expect(dependencyTargetIdentityCounts('{"unidentifiedTargets":0}')).toEqual({
      unidentifiedTargets: 0,
    });
  });

  it.each([
    null,
    "null",
    "[]",
    "{}",
    "PRIVATE_INVALID_VALUE",
    '{"unidentifiedTargets":"PRIVATE_COUNT"}',
    '{"unidentifiedTargets":-1}',
    '{"unidentifiedTargets":1.5}',
    '{"unidentifiedTargets":9007199254740992}',
  ])("does not expose malformed or unknown counts: %s", (value) => {
    expect(dependencyTargetIdentityCounts(value)).toBeNull();
  });
});
