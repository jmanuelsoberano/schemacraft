import { describe, expect, it } from "vitest";

import { messageCatalogs } from "@/shared/i18n/messages/catalogs";

import {
  accessCauses,
  describeAccessCause,
  grantHelps,
  partialReadOutcome,
  primaryCause,
} from "./accessCause";
import { personas, profile, schema, translatorFor } from "./testFixtures";

describe("accessCauses", () => {
  it("names nothing for a full capture", () => {
    expect(accessCauses(personas.owner)).toEqual([]);
    expect(primaryCause(personas.owner)).toBeNull();
  });

  it("names the missing permission for each persona", () => {
    expect(accessCauses(personas.reader)).toEqual([{ kind: "noDefinitions" }]);
    expect(accessCauses(personas.salesViewDefinition)).toEqual([
      { kind: "someSchemas", schemas: ["audit", "dbo"] },
    ]);
    expect(accessCauses(personas.twoTables)).toEqual([
      { kind: "noDefinitions" },
      { kind: "someObjects" },
    ]);
    expect(accessCauses(personas.connectOnly)).toEqual([{ kind: "nothingVisible.noGrant" }]);
    expect(accessCauses(personas.emptyDatabase)).toEqual([{ kind: "empty" }]);
  });

  it("puts explicit denials first and lets them explain the missing objects", () => {
    expect(accessCauses(personas.viewDefinitionDenyAudit)).toEqual([{ kind: "denied", count: 1 }]);
    expect(accessCauses(personas.denialsUnknown)).toEqual([{ kind: "denialsUnknown" }]);
    const deniedReader = profile(
      "partial",
      { objects: "partial", definitions: "notAvailable" },
      { canReadDefinitions: false, explicitDenials: 2 },
    );
    expect(accessCauses(deniedReader)).toEqual([
      { kind: "denied", count: 2 },
      { kind: "noDefinitions" },
    ]);
  });

  it("hedges when a login with some grant sees nothing", () => {
    // db_datareader on an empty database cannot be told apart from a hidden schema.
    expect(accessCauses(personas.readerOnEmptyDatabase)).toEqual([
      { kind: "nothingVisible.hidden" },
    ]);
    const deniedEverything = profile(
      "nothingVisible",
      { objects: "notAvailable", definitions: "notAvailable" },
      { canReadDefinitions: false, canReadData: false, schemas: [], explicitDenials: 1 },
    );
    expect(accessCauses(deniedEverything)).toEqual([{ kind: "nothingVisible.hidden" }]);
  });

  it("judges missing texts within the capture's schemas only", () => {
    const narrowed = profile(
      "partial",
      { objects: "complete", definitions: "partial" },
      {
        canReadDefinitions: false,
        schemas: [
          schema("audit", { canReadDefinitions: false }),
          schema("dbo", { canReadDefinitions: false }),
          schema("sales"),
        ],
      },
      ["dbo", "sales"],
    );
    expect(accessCauses(narrowed)).toEqual([{ kind: "someSchemas", schemas: ["dbo"] }]);
    const everySchemaGranted = profile("partial", { objects: "complete", definitions: "partial" });
    expect(accessCauses(everySchemaGranted)).toEqual([{ kind: "someDefinitions" }]);
  });
});

describe("partialReadOutcome", () => {
  it("names what the read leaves out, so the notice promises only marks that exist", () => {
    // Texts are marked as not available; missing objects are simply absent.
    expect(partialReadOutcome(personas.reader)).toBe("definitions");
    expect(partialReadOutcome(personas.salesViewDefinition)).toBe("definitions");
    expect(partialReadOutcome(personas.viewDefinitionDenyAudit)).toBe("objects");
    expect(partialReadOutcome(personas.denialsUnknown)).toBe("objects");
    expect(partialReadOutcome(personas.twoTables)).toBe("both");
    expect(
      partialReadOutcome(
        profile(
          "partial",
          { objects: "partial", definitions: "partial" },
          { canReadDefinitions: false, explicitDenials: 2 },
        ),
      ),
    ).toBe("both");
  });

  it("has a sentence in both languages for each outcome, none of which marks objects", () => {
    for (const locale of ["en", "es"] as const) {
      const { t } = translatorFor(locale);
      const definitions = t("access.notice.partial.readAnyway.definitions");
      const objects = t("access.notice.partial.readAnyway.objects");
      const both = t("access.notice.partial.readAnyway.both");
      expect(definitions).toMatch(/not available|no disponibles/u);
      expect(objects).not.toMatch(/not available|no disponible/u);
      expect(both).toMatch(/not available|no disponibles/u);
      expect(both).toMatch(/diagram/u);
    }
  });
});

describe("grantHelps", () => {
  it("offers the script when VIEW DEFINITION is what is missing", () => {
    expect(grantHelps(personas.reader)).toBe(true);
    expect(grantHelps(personas.salesViewDefinition)).toBe(true);
    expect(grantHelps(personas.twoTables)).toBe(true);
    expect(grantHelps(personas.connectOnly)).toBe(true);
  });

  it("never offers it against a denial, seen or unseen, or when nothing is missing", () => {
    expect(grantHelps(personas.viewDefinitionDenyAudit)).toBe(false);
    expect(grantHelps(personas.denialsUnknown)).toBe(false);
    expect(grantHelps(personas.readerOnEmptyDatabase)).toBe(false);
    expect(
      grantHelps(
        profile(
          "partial",
          { objects: "partial", definitions: "notAvailable" },
          { canReadDefinitions: false, explicitDenials: 2 },
        ),
      ),
    ).toBe(false);
    expect(grantHelps(personas.owner)).toBe(false);
    expect(grantHelps(personas.emptyDatabase)).toBe(false);
  });
});

describe("describeAccessCause", () => {
  const english = translatorFor("en");
  const spanish = translatorFor("es");

  it("lists the schemas in the language of the interface", () => {
    const cause = { kind: "someSchemas", schemas: ["audit", "dbo"] } as const;
    expect(describeAccessCause(cause, english)).toContain("audit and dbo");
    expect(describeAccessCause(cause, spanish)).toContain("audit y dbo");
  });

  it("counts denials with plural forms", () => {
    expect(describeAccessCause({ kind: "denied", count: 1 }, english)).toMatch(/^1 explicit DENY /);
    expect(describeAccessCause({ kind: "denied", count: 3 }, english)).toMatch(
      /^3 explicit DENYs /,
    );
  });

  it("says 'not visible' in Spanish, never 'oculto', which means hidden on the canvas", () => {
    const accessMessages = Object.entries(messageCatalogs.es).filter(([key]) =>
      key.startsWith("access."),
    );
    expect(accessMessages.length).toBeGreaterThan(0);
    for (const [key, message] of accessMessages) {
      expect(message.toLowerCase(), key).not.toMatch(/ocult/);
    }
  });
});
