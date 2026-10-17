import { describe, expect, it } from "vitest";

/**
 * The primitives sit below every other module of the interface: their text and their state come
 * in through props, so they import nothing from the application, as the architecture page says
 * of shared/ui. A type another module needs from a primitive is declared here and imported from
 * here, never the other way round.
 */
const SOURCES = import.meta.glob<string>(["./**/*.{ts,tsx}", "!./**/*.test.ts"], {
  query: "?raw",
  eager: true,
  import: "default",
});

describe("shared/ui", () => {
  it("imports no other module of the application", () => {
    expect(Object.keys(SOURCES)).toContain("./PanelResizer.tsx");
    for (const [path, source] of Object.entries(SOURCES)) {
      expect(source, path).not.toMatch(/from\s+["']@\//u);
    }
  });
});
