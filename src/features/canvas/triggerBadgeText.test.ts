import { describe, expect, it } from "vitest";

import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";

import { triggerBadgeLabel } from "./triggerBadgeText";

describe("trigger badge sentences", () => {
  it("distinguishes enabled INSTEAD OF from disabled triggers in both languages", () => {
    const badge = {
      enabled: 2,
      disabled: 1,
      insteadOf: 1,
      disabledInsteadOf: 1,
      count: 2,
      allDisabled: false,
    };
    expect(triggerBadgeLabel(badge, createCatalogTranslator(messageCatalogs.en, "en"))).toBe(
      "2 triggers are enabled. 1 of the enabled triggers uses INSTEAD OF. 1 trigger is disabled.",
    );
    expect(triggerBadgeLabel(badge, createCatalogTranslator(messageCatalogs.es, "es"))).toBe(
      "2 desencadenadores están habilitados. 1 de los desencadenadores habilitados usa INSTEAD OF. 1 desencadenador está deshabilitado.",
    );
  });
  it("describes disabled INSTEAD OF only as disabled, with singular and plural forms", () => {
    for (const count of [1, 2]) {
      const badge = {
        enabled: 0,
        disabled: count,
        insteadOf: 0,
        disabledInsteadOf: count,
        count,
        allDisabled: true,
      };
      for (const locale of ["en", "es"] as const) {
        const translator = createCatalogTranslator(messageCatalogs[locale], locale);
        expect(triggerBadgeLabel(badge, translator)).toBe(
          `${translator.tCount("entity.triggers.disabled", count)} ${translator.tCount("entity.triggers.disabledInsteadOf", count)}`,
        );
      }
    }
  });
});
