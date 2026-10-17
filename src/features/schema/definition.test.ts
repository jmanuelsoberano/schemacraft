import { describe, expect, it } from "vitest";

import type { Definition } from "@/shared/contracts";

import { definitionText, isUnknownDefinition } from "./definition";

describe("definition", () => {
  const readable: Definition = { status: "readable", text: "([Quantity]>(0))" };

  it("returns the text only when the capture could read it", () => {
    expect(definitionText(readable)).toBe("([Quantity]>(0))");
    expect(definitionText({ status: "readable", text: "" })).toBe("");
    expect(definitionText({ status: "notVisible" })).toBeNull();
    expect(definitionText({ status: "notRecorded" })).toBeNull();
    expect(definitionText({ status: "unknown" })).toBeNull();
  });

  it("treats only a 1.0 gap as unknown; a hidden or newer state is not available", () => {
    expect(isUnknownDefinition({ status: "notRecorded" })).toBe(true);
    expect(isUnknownDefinition({ status: "notVisible" })).toBe(false);
    expect(isUnknownDefinition({ status: "unknown" })).toBe(false);
    expect(isUnknownDefinition(readable)).toBe(false);
  });
});
