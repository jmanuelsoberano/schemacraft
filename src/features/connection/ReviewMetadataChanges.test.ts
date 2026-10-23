import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RefreshMetadataDiff } from "@/shared/contracts";

vi.mock("@/shared/i18n/useI18n", () => ({
  useI18n: () => ({
    locale: "en",
    t: (key: string) => key,
    tCount: (key: string, count: number) => `${key}:${String(count)}`,
  }),
}));

const { ReviewMetadataChanges } = await import("./ReviewMetadataChanges");
const { hasMetadataReview } = await import("./reviewMetadata");

function metadata(): RefreshMetadataDiff {
  return {
    dependencies: {
      changes: [],
      newlyRecorded: false,
      newlyAvailableSources: 0,
      excluded: false,
      scopeChanged: false,
      captureChanged: false,
      capture: null,
      notChecked: [],
      readFailure: null,
    },
    nativeChanges: [],
    nativeNotChecked: [],
    nativeRecorded: false,
  };
}

describe("refresh metadata presentation", () => {
  it("does not fabricate a review when the older contract has no metadata", () => {
    expect(hasMetadataReview(undefined)).toBe(false);
    expect(
      renderToStaticMarkup(createElement(ReviewMetadataChanges, { metadata: undefined })),
    ).toBe("");
    expect(
      renderToStaticMarkup(createElement(ReviewMetadataChanges, { metadata: metadata() })),
    ).toBe("");
  });

  it("distinguishes deliberate exclusion and failed verification from removals", () => {
    const excluded = metadata();
    excluded.dependencies.excluded = true;
    const excludedHtml = renderToStaticMarkup(
      createElement(ReviewMetadataChanges, { metadata: excluded }),
    );
    expect(excludedHtml).toContain("review.metadata.excluded");
    expect(excludedHtml).not.toContain("review.summary.removed");
    const failed = metadata();
    failed.dependencies.readFailure = "permissionDenied";
    failed.dependencies.notChecked = [
      {
        object: { kind: "table", name: { schema: "odd.schema", name: "order.items" } },
        coverage: "complete",
        readAt: "2026-10-20T12:00:00Z",
        retained: true,
      },
    ];
    const failedHtml = renderToStaticMarkup(
      createElement(ReviewMetadataChanges, { metadata: failed }),
    );
    expect(failedHtml).toContain("dependencies.reason.permissionDenied");
    expect(failedHtml).toContain("comparison.status.retained");
    expect(failedHtml).toContain("[odd.schema].[order.items]");
    expect(failedHtml).not.toContain("review.summary.removed");
  });

  it("renders confirmed source counts and native values as escaped literal facts", () => {
    const diff = metadata();
    diff.dependencies.changes.push({
      object: { kind: "table", name: { schema: "sales", name: "Orders" } },
      added: 2,
      removed: 1,
    });
    const observation = { status: "observed" as const, readAt: "2026-10-23T12:00:00Z" };
    diff.nativeChanges.push({
      object: {
        kind: "table",
        name: { schema: "sales", name: "<script>" },
        memberName: null,
        identityArguments: null,
      },
      properties: [
        {
          path: ["postgresql", "constraints", "fk", "isDeferrable"],
          result: "different",
          reference: { observation, value: "false" },
          compared: { observation, value: "true" },
        },
      ],
    });
    const html = renderToStaticMarkup(createElement(ReviewMetadataChanges, { metadata: diff }));
    expect(html).toContain("review.summary.added:2");
    expect(html).toContain("review.summary.removed:1");
    expect(html).toContain("isDeferrable");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
