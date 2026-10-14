import { describe, expect, it } from "vitest";

import { OperationError, inspectorErrorKind, toOperationError } from "./operationError";

describe("toOperationError", () => {
  it("keeps structured command errors", () => {
    const error = toOperationError({
      kind: { type: "inspector", value: "authenticationFailed" },
      message: "Login failed for user 'app'.",
    });
    expect(error).toBeInstanceOf(OperationError);
    expect(error.kind).toEqual({ type: "inspector", value: "authenticationFailed" });
    expect(error.message).toBe("Login failed for user 'app'.");
    expect(inspectorErrorKind(error)).toBe("authenticationFailed");
  });

  it("returns operation errors unchanged", () => {
    const original = new OperationError({ type: "unknownJob" }, "gone");
    expect(toOperationError(original)).toBe(original);
  });

  it("wraps native errors and strings as unexpected", () => {
    expect(toOperationError(new Error("boom"))).toMatchObject({
      kind: { type: "unexpected" },
      message: "boom",
    });
    expect(toOperationError("plain text").message).toBe("plain text");
    expect(toOperationError(42).message).toBe("Unknown error");
  });

  it("rejects objects that only look like command errors", () => {
    const error = toOperationError({ kind: "authenticationFailed", message: "no type field" });
    expect(error.kind).toEqual({ type: "unexpected" });
    expect(inspectorErrorKind(error)).toBeNull();
  });
});
