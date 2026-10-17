import { describe, expect, it } from "vitest";

import { formatMessage, formatMessageParts, placeholderNames, pluralKey } from "./formatMessage";

describe("formatMessage", () => {
  it("interpolates string and numeric parameters", () => {
    expect(
      formatMessage("{count} tables in {database}", { count: 12, database: "Northwind" }),
    ).toBe("12 tables in Northwind");
  });

  it("keeps unknown placeholders visible", () => {
    expect(formatMessage("Zoom {percent}%")).toBe("Zoom {percent}%");
  });

  it("lists placeholder names", () => {
    expect(placeholderNames("{count} of {total} ({count})")).toEqual(["count", "total", "count"]);
    expect(placeholderNames("plain text")).toEqual([]);
  });
});

describe("formatMessageParts", () => {
  it("pairs placeholders with their parameters between runs of text", () => {
    expect(
      formatMessageParts("{column} must be one of {values}", { column: 1, values: 2 }),
    ).toEqual([
      { kind: "parameter", name: "column", value: 1 },
      { kind: "text", text: " must be one of " },
      { kind: "parameter", name: "values", value: 2 },
    ]);
  });

  it("keeps adjacent placeholders apart and drops empty text", () => {
    expect(formatMessageParts("{a}{b}", { a: "x", b: "y" })).toEqual([
      { kind: "parameter", name: "a", value: "x" },
      { kind: "parameter", name: "b", value: "y" },
    ]);
    expect(formatMessageParts("", {})).toEqual([]);
  });

  it("keeps an unknown placeholder visible as text, merged with its neighbours", () => {
    expect(formatMessageParts("Zoom {percent}% of {name}", { name: "Orders" })).toEqual([
      { kind: "text", text: "Zoom {percent}% of " },
      { kind: "parameter", name: "name", value: "Orders" },
    ]);
    // An inherited property is not a parameter.
    expect(formatMessageParts("{toString}", {})).toEqual([{ kind: "text", text: "{toString}" }]);
  });

  it("returns a template without placeholders as one run of text", () => {
    expect(formatMessageParts("At least one of these must hold:", { unused: 1 })).toEqual([
      { kind: "text", text: "At least one of these must hold:" },
    ]);
  });
});

describe("pluralKey", () => {
  it("selects the singular form only for one", () => {
    expect(pluralKey("statusBar.tables", 1, "en")).toBe("statusBar.tables.one");
    expect(pluralKey("statusBar.tables", 0, "en")).toBe("statusBar.tables.other");
    expect(pluralKey("statusBar.tables", 2, "en")).toBe("statusBar.tables.other");
  });

  it("applies the plural rules of the given locale", () => {
    expect(pluralKey("statusBar.tables", 1, "es")).toBe("statusBar.tables.one");
    expect(pluralKey("statusBar.tables", 21, "es")).toBe("statusBar.tables.other");
  });
});
