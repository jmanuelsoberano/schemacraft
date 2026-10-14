import { describe, expect, it } from "vitest";

import { formatMessage, placeholderNames, pluralKey } from "./formatMessage";

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
