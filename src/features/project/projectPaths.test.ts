import { describe, expect, it } from "vitest";

import { projectDirectory, projectDisplayName } from "./projectPaths";

describe("projectDisplayName", () => {
  it("strips the folder and the extension on both path styles", () => {
    expect(projectDisplayName("C:\\Projects\\northwind.scraft")).toBe("northwind");
    expect(projectDisplayName("/home/ana/projects/Shop.SCRAFT")).toBe("Shop");
    expect(projectDisplayName("notes.txt")).toBe("notes.txt");
  });
});

describe("projectDirectory", () => {
  it("keeps the folder with the separator style of the path", () => {
    expect(projectDirectory("C:\\Projects\\northwind.scraft")).toBe("C:\\Projects");
    expect(projectDirectory("/home/ana/projects/shop.scraft")).toBe("/home/ana/projects");
    expect(projectDirectory("shop.scraft")).toBe("");
  });
});
