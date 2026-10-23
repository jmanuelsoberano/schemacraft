import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import type { Locale } from "@/shared/i18n/locales";
import type * as I18nModule from "@/shared/i18n/useI18n";

import { comparisonFixture } from "./comparisonFixtures";
import { EMPTY_COMPARISON_FILTERS } from "./comparisonModel";

const view = vi.hoisted((): { locale: Locale; state: Record<string, unknown> } => ({
  locale: "en",
  state: {},
}));

vi.mock("./comparisonStore", () => ({ useComparisonStore: () => view.state }));
vi.mock("@/shared/i18n/useI18n", async (original) => {
  const actual = await original<typeof I18nModule>();
  const { createCatalogTranslator } = await import("@/shared/i18n/translator");
  const { messageCatalogs } = await import("@/shared/i18n/messages/catalogs");
  return {
    ...actual,
    useI18n: () => createCatalogTranslator(messageCatalogs[view.locale], view.locale),
  };
});

vi.mock("@/shared/ui/Dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

const { ComparisonDialog } = await import("./ComparisonDialog");

describe("comparison empty result wording", () => {
  it.each(["en", "es"] as const)(
    "distinguishes filtered differences, filtered uncertainty and no differences in %s",
    (locale) => {
      view.locale = locale;
      for (const result of ["different", "notComparable"] as const) {
        const comparison = comparisonFixture();
        const item = comparison.items[0];
        if (item === undefined) throw new Error("fixture item expected");
        item.result = result;
        view.state = {
          comparison,
          reference: null,
          compared: null,
          selectedKey: null,
          source: null,
          reportPreview: null,
          failure: null,
          phase: "idle",
          filters: { ...EMPTY_COMPARISON_FILTERS, query: "no matching object" },
        };
        const filteredHtml = renderToStaticMarkup(createElement(ComparisonDialog));
        expect(filteredHtml).toContain(messageCatalogs[locale]["comparison.noMatches"]);
        expect(filteredHtml).not.toContain(messageCatalogs[locale]["comparison.empty"]);
      }

      const equal = comparisonFixture();
      equal.items = [];
      view.state = { ...view.state, comparison: equal };
      const equalHtml = renderToStaticMarkup(createElement(ComparisonDialog));
      expect(equalHtml).toContain(messageCatalogs[locale]["comparison.empty"]);
      expect(equalHtml).not.toContain(messageCatalogs[locale]["comparison.noMatches"]);
    },
  );
});
