import { describe, expect, it } from "vitest";

import { detectInitialLocale, isSupportedLocale } from "./locales";

describe("detectInitialLocale", () => {
  it("matches on the primary language subtag", () => {
    expect(detectInitialLocale(["es-MX", "en-US"])).toBe("es");
    expect(detectInitialLocale(["EN-GB"])).toBe("en");
  });

  it("skips unsupported languages until a supported one appears", () => {
    expect(detectInitialLocale(["fr-FR", "de", "es"])).toBe("es");
  });

  it("falls back to English when nothing matches", () => {
    expect(detectInitialLocale(["fr-FR"])).toBe("en");
    expect(detectInitialLocale([])).toBe("en");
  });
});

describe("isSupportedLocale", () => {
  it("accepts exactly the supported codes", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("es")).toBe(true);
    expect(isSupportedLocale("pt")).toBe(false);
  });
});
