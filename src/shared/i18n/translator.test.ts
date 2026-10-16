import { describe, expect, it } from "vitest";

import { createCatalogTranslator } from "./translator";
import type { CatalogTranslator, PluralBase } from "./translator";

const catalog = {
  greeting: "Hello, {name}",
  zoom: "Zoom {percent}%",
  "tables.one": "{count} table",
  "tables.other": "{count} tables",
  plain: "Plain text",
} as const;

type Key = keyof typeof catalog;

describe("createCatalogTranslator", () => {
  const english = createCatalogTranslator<Key>(catalog, "en");

  it("interpolates parameters and keeps unknown placeholders visible", () => {
    expect(english.t("greeting", { name: "Ada" })).toBe("Hello, Ada");
    expect(english.t("zoom")).toBe("Zoom {percent}%");
    expect(english.t("plain")).toBe("Plain text");
    expect(english.locale).toBe("en");
  });

  it("hands out the message as written", () => {
    expect(english.template("greeting")).toBe("Hello, {name}");
  });

  it("chooses the plural form by the rules of its locale", () => {
    expect(english.tCount("tables", 1)).toBe("1 table");
    expect(english.tCount("tables", 0)).toBe("0 tables");
    expect(english.tCount("tables", 2)).toBe("2 tables");
    const spanish = createCatalogTranslator<Key>(
      { ...catalog, "tables.one": "{count} tabla", "tables.other": "{count} tablas" },
      "es",
    );
    expect(spanish.tCount("tables", 1)).toBe("1 tabla");
    expect(spanish.tCount("tables", 21)).toBe("21 tablas");
  });

  it("knows which keys come in plural forms", () => {
    // `greeting` has no `.one`/`.other` pair, so it is not a plural base.
    const base: PluralBase<Key> = "tables";
    expect(base).toBe("tables");
    // A translator over a wider catalogue serves a narrower one, which is how the shared
    // view-model accepts the application's translator and the viewer's alike.
    const narrower: CatalogTranslator<"plain" | "tables.one" | "tables.other"> = english;
    expect(narrower.tCount("tables", 3)).toBe("3 tables");
  });
});
