import { describe, expect, it } from "vitest";

import { placeholderNames } from "../formatMessage";
import { SUPPORTED_LOCALES } from "../locales";
import { messageCatalogs } from "./catalogs";
import { englishMessages } from "./en";

const referenceKeys = Object.keys(englishMessages).sort();

describe.each(SUPPORTED_LOCALES)("%s message catalogue", (locale) => {
  const catalog = messageCatalogs[locale];

  it("defines exactly the reference keys", () => {
    expect(Object.keys(catalog).sort()).toEqual(referenceKeys);
  });

  it("has no empty messages", () => {
    for (const [key, message] of Object.entries(catalog)) {
      expect(message.trim(), `message "${key}"`).not.toBe("");
    }
  });

  it("uses the same placeholders as the reference message", () => {
    for (const [key, message] of Object.entries(englishMessages)) {
      const translated = catalog[key as keyof typeof englishMessages];
      expect(placeholderNames(translated).sort(), `placeholders of "${key}"`).toEqual(
        placeholderNames(message).sort(),
      );
    }
  });
});
