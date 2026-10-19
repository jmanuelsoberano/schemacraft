import { describe, expect, it } from "vitest";

import type { Definition } from "@/shared/contracts";

import {
  definitionText,
  isEncryptedDefinition,
  isUnknownDefinition,
  withoutText,
} from "./definition";

describe("definition", () => {
  const readable: Definition = { status: "readable", text: "([Quantity]>(0))" };

  it("returns the text only when the capture could read it", () => {
    expect(definitionText(readable)).toBe("([Quantity]>(0))");
    expect(definitionText({ status: "readable", text: "" })).toBe("");
    expect(definitionText({ status: "notVisible" })).toBeNull();
    expect(definitionText({ status: "encrypted" })).toBeNull();
    expect(definitionText({ status: "notRecorded" })).toBeNull();
    expect(definitionText({ status: "unknown" })).toBeNull();
  });

  it("treats only a 1.0 gap as unknown; a hidden, encrypted or newer state is not", () => {
    expect(isUnknownDefinition({ status: "notRecorded" })).toBe(true);
    expect(isUnknownDefinition({ status: "notVisible" })).toBe(false);
    expect(isUnknownDefinition({ status: "encrypted" })).toBe(false);
    expect(isUnknownDefinition({ status: "unknown" })).toBe(false);
    expect(isUnknownDefinition(readable)).toBe(false);
  });

  it("tells an encrypted module from a text the login cannot see", () => {
    expect(isEncryptedDefinition({ status: "encrypted" })).toBe(true);
    expect(isEncryptedDefinition({ status: "notVisible" })).toBe(false);
    expect(isEncryptedDefinition({ status: "notRecorded" })).toBe(false);
    expect(isEncryptedDefinition({ status: "unknown" })).toBe(false);
    expect(isEncryptedDefinition(readable)).toBe(false);
  });

  it("strips every text and keeps only why a text is missing", () => {
    expect(withoutText(readable)).toEqual({ status: "unknown" });
    expect(withoutText({ status: "notVisible" })).toEqual({ status: "notVisible" });
    expect(withoutText({ status: "encrypted" })).toEqual({ status: "encrypted" });
    expect(withoutText({ status: "notRecorded" })).toEqual({ status: "notRecorded" });
    expect(withoutText({ status: "unknown" })).toEqual({ status: "unknown" });
  });

  it("lets nothing but the status through, whatever a newer version put next to it", () => {
    const SENTINEL = "SELECT secret FROM hidden.Table";
    // States a newer version might write, carrying a text this version does not know about.
    const newer = {
      status: "notCheckedSince",
      readAt: "2026-10-01",
      text: SENTINEL,
    } as unknown as Definition;
    const carried = [
      { status: "notVisible", text: SENTINEL },
      { status: "encrypted", lastText: SENTINEL },
      { status: "notRecorded", previous: { text: SENTINEL } },
      { status: "unknown", text: SENTINEL },
    ] as unknown as Definition[];
    for (const definition of [...carried, newer]) {
      expect(JSON.stringify(withoutText(definition))).not.toContain(SENTINEL);
      expect(Object.keys(withoutText(definition))).toEqual(["status"]);
    }
    expect(withoutText(newer)).toEqual({ status: "unknown" });
  });
});
