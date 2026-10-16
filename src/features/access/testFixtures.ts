// Access profiles of the logins the SQL Server permission fixture uses, shaped as the Rust rules
// report them, for the unit tests of this feature.
import type {
  AccessLevel,
  AccessProbe,
  AccessProfile,
  Completeness,
  SchemaAccess,
} from "@/shared/contracts";
import { formatMessage, pluralKey } from "@/shared/i18n/formatMessage";
import type { Locale } from "@/shared/i18n/locales";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
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
): AccessProfile {
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

/** One profile per persona of `permission_logins.sql`. */
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
  denialsUnknown: profile(
    "partial",
    { objects: "partial", definitions: "complete" },
    {
      explicitDenials: null,
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
  const t: Translator["t"] = (key, parameters) =>
    formatMessage(messageCatalogs[locale][key], parameters);
  return {
    locale,
    t,
    tCount: (base, count) => t(pluralKey(base, count, locale), { count }),
  };
}
