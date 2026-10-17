import { describe, expect, it } from "vitest";

import { quoteIdentifier } from "./sqlIdentifiers";

describe("quoteIdentifier", () => {
  it("wraps names in brackets", () => {
    expect(quoteIdentifier("sales")).toBe("[sales]");
    expect(quoteIdentifier("Order Details")).toBe("[Order Details]");
  });

  it("doubles closing brackets and leaves everything else alone", () => {
    expect(quoteIdentifier("odd]name")).toBe("[odd]]name]");
    expect(quoteIdentifier("]]")).toBe("[]]]]]");
    expect(quoteIdentifier("[x")).toBe("[[x]");
    expect(quoteIdentifier("Año'Ünïcode")).toBe("[Año'Ünïcode]");
  });
});
