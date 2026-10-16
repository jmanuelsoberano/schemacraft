import { describe, expect, it } from "vitest";

import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";

import { createViewerTranslator, describeDefinition } from "./messages";

describe.each(SUPPORTED_LOCALES)("%s viewer catalogue", (locale) => {
  const t = createViewerTranslator(locale);
  const app = messageCatalogs[locale];

  it("says what the application says about partial access and missing texts", () => {
    expect(t("note.partial")).toBe(app["export.note.partial"]);
    expect(t("panel.notAvailable")).toBe(app["definition.notAvailable"]);
    expect(t("panel.notRecorded")).toBe(app["definition.notRecorded"]);
  });

  it("shows an expression text, or why it is missing", () => {
    expect(describeDefinition({ status: "readable", text: "(getdate())" }, t)).toBe("(getdate())");
    expect(describeDefinition({ status: "notVisible" }, t)).toBe(app["definition.notAvailable"]);
    expect(describeDefinition({ status: "unknown" }, t)).toBe(app["definition.notAvailable"]);
    expect(describeDefinition({ status: "notRecorded" }, t)).toBe(app["definition.notRecorded"]);
  });
});

it("prints the panel states in each language", () => {
  const english = createViewerTranslator("en");
  const spanish = createViewerTranslator("es");
  expect(describeDefinition({ status: "notVisible" }, english)).toBe("not available");
  expect(describeDefinition({ status: "notVisible" }, spanish)).toBe("no disponible");
  expect(describeDefinition({ status: "notRecorded" }, spanish)).toBe("no registrado");
});
