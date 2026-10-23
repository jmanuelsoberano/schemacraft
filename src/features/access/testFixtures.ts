// Access profiles of the logins the SQL Server permission fixture uses, shaped as the Rust rules
// report them, for the unit tests of this feature.
import type {
  AccessLevel,
  AccessProbe,
  AccessProfile,
  Completeness,
  SchemaAccess,
} from "@/shared/contracts";
import type { Locale } from "@/shared/i18n/locales";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";
import type { Translator } from "@/shared/i18n/useI18n";

export function schema(name: string, grants: Partial<SchemaAccess> = {}): SchemaAccess {
  return {
    name,
    canReadDefinitions: true,
    canReadData: true,
    isDenied: false,
    hasVisibleObjects: true,
    ...grants,
  };
}

export function profile(
  level: AccessLevel,
  coverage: { objects: Completeness; definitions: Completeness },
  probe: Partial<AccessProbe> = {},
  scope: readonly string[] = [],
): AccessProfile & { probe: AccessProbe } {
  return {
    probe: {
      canReadDefinitions: true,
      canReadData: true,
      explicitDenials: 0,
      seesObjects: level === "full" || level === "partial",
      schemas: [schema("dbo"), schema("sales")],
      databaseUser: "reporting",
      ...probe,
    },
    scope: { schemas: [...scope], includeViews: true },
    level,
    coverage,
    counts: { definitions: 0, definitionsNotVisible: 0, foreignKeysToInvisibleTables: 0 },
  };
}

const complete = { objects: "complete", definitions: "complete" } as const;
const nothing = { objects: "notAvailable", definitions: "notAvailable" } as const;

/** One profile per persona of `permission_logins.sql` and `permission_logins_2022.sql`. */
export const personas = {
  owner: profile("full", complete),
  reader: profile(
    "partial",
    { objects: "complete", definitions: "notAvailable" },
    {
      canReadDefinitions: false,
      schemas: [
        schema("dbo", { canReadDefinitions: false }),
        schema("sales", { canReadDefinitions: false }),
      ],
    },
  ),
  salesViewDefinition: profile(
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
  ),
  twoTables: profile(
    "partial",
    { objects: "partial", definitions: "notAvailable" },
    {
      canReadDefinitions: false,
      canReadData: false,
      schemas: [schema("sales", { canReadDefinitions: false, canReadData: false })],
    },
  ),
  connectOnly: profile("nothingVisible", nothing, {
    canReadDefinitions: false,
    canReadData: false,
    schemas: [],
    databaseUser: "app_connect",
  }),
  viewDefinitionDenyAudit: profile(
    "partial",
    { objects: "partial", definitions: "complete" },
    {
      explicitDenials: 1,
      schemas: [
        schema("audit", {
          canReadDefinitions: false,
          canReadData: false,
          isDenied: true,
          hasVisibleObjects: false,
        }),
        schema("dbo"),
        schema("sales"),
      ],
    },
  ),
  // VIEW DEFINITION with VIEW SECURITY DEFINITION denied (SQL Server 2022 and later): it reads
  // every object and text, but SQL Server hides its denials and its own user from it.
  denialsUnknown: profile(
    "partial",
    { objects: "partial", definitions: "complete" },
    {
      canReadData: false,
      explicitDenials: null,
      schemas: [
        schema("audit", { canReadData: false }),
        schema("dbo", { canReadData: false }),
        schema("sales", { canReadData: false }),
      ],
      databaseUser: null,
    },
  ),
  emptyDatabase: profile("empty", complete, { seesObjects: false, schemas: [] }),
  readerOnEmptyDatabase: profile("nothingVisible", nothing, {
    canReadDefinitions: false,
    seesObjects: false,
    schemas: [],
  }),
} satisfies Record<string, AccessProfile>;

/** A translator over the real catalogues, without the settings store behind `useI18n`. */
export function translatorFor(locale: Locale): Translator {
  return createCatalogTranslator(messageCatalogs[locale], locale);
}
