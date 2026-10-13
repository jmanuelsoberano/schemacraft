import { describe, expect, it } from "vitest";

import { toggleSchema } from "./schemaSelection";

const ALL = ["dbo", "hr", "sales"];

describe("toggleSchema", () => {
  it("unchecking one schema from 'all' keeps the others, in catalog order", () => {
    expect(toggleSchema(ALL, [], "hr", false)).toEqual(["dbo", "sales"]);
  });

  it("checking the last missing schema collapses back to 'all'", () => {
    expect(toggleSchema(ALL, ["dbo", "sales"], "hr", true)).toEqual([]);
  });

  it("ignores redundant toggles", () => {
    expect(toggleSchema(ALL, ["dbo"], "dbo", true)).toEqual(["dbo"]);
    expect(toggleSchema(ALL, ["dbo"], "hr", false)).toEqual(["dbo"]);
  });
});
