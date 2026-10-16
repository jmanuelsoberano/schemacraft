import { definitionText, isUnknownDefinition } from "@/features/schema/definition";
import type { Definition } from "@/shared/contracts";
import type { Locale } from "@/shared/i18n/locales";

/** The viewer's own small catalogue; it must not pull the application's stores. */
const ENGLISH = {
  "search.placeholder": "Search tables and views",
  "search.empty": "Nothing matches",
  "label.view": "VIEW",
  "level.compact": "Compact",
  "level.keys": "Keys",
  "level.full": "Full",
  "level.label": "Detail level",
  "action.fit": "Fit",
  "action.theme": "Switch theme",
  "action.close": "Close",
  "summary.tables.one": "{count} table",
  "summary.tables.other": "{count} tables",
  "summary.views.one": "{count} view",
  "summary.views.other": "{count} views",
  "summary.relations.one": "{count} relation",
  "summary.relations.other": "{count} relations",
  "footer.exported": "Exported {date} with {generator}",
  "note.partial":
    "Partial capture: some tables, views or expressions weren't visible to the login that read the schema.",
  "panel.table": "Table",
  "panel.view": "View",
  "panel.columns": "Columns",
  "panel.column": "Column",
  "panel.type": "Type",
  "panel.nullable": "Nullable",
  "panel.yes": "Yes",
  "panel.no": "No",
  "panel.primaryKey": "Primary key",
  "panel.indexes": "Indexes",
  "panel.unique": "unique",
  "panel.clustered": "clustered",
  "panel.foreignKeys": "References",
  "panel.referencedBy": "Referenced by",
  "panel.checks": "Check constraints",
  "panel.identity": "identity",
  "panel.computed": "computed",
  "panel.default": "default",
  "panel.disabled": "disabled",
  "panel.none": "None",
  "panel.notAvailable": "not available",
  "panel.notRecorded": "not recorded",
} as const;

export type ViewerMessageKey = keyof typeof ENGLISH;

const SPANISH: Record<ViewerMessageKey, string> = {
  "search.placeholder": "Buscar tablas y vistas",
  "search.empty": "Nada coincide",
  "label.view": "VISTA",
  "level.compact": "Compacta",
  "level.keys": "Claves",
  "level.full": "Completa",
  "level.label": "Nivel de detalle",
  "action.fit": "Ajustar",
  "action.theme": "Cambiar tema",
  "action.close": "Cerrar",
  "summary.tables.one": "{count} tabla",
  "summary.tables.other": "{count} tablas",
  "summary.views.one": "{count} vista",
  "summary.views.other": "{count} vistas",
  "summary.relations.one": "{count} relación",
  "summary.relations.other": "{count} relaciones",
  "footer.exported": "Exportado el {date} con {generator}",
  "note.partial":
    "Captura parcial: algunas tablas, vistas o expresiones no eran visibles para el inicio de sesión que leyó el esquema.",
  "panel.table": "Tabla",
  "panel.view": "Vista",
  "panel.columns": "Columnas",
  "panel.column": "Columna",
  "panel.type": "Tipo",
  "panel.nullable": "Admite NULL",
  "panel.yes": "Sí",
  "panel.no": "No",
  "panel.primaryKey": "Clave primaria",
  "panel.indexes": "Índices",
  "panel.unique": "único",
  "panel.clustered": "agrupado",
  "panel.foreignKeys": "Referencia a",
  "panel.referencedBy": "Referenciada por",
  "panel.checks": "Restricciones CHECK",
  "panel.identity": "identidad",
  "panel.computed": "calculada",
  "panel.default": "predeterminado",
  "panel.disabled": "deshabilitada",
  "panel.none": "Ninguna",
  "panel.notAvailable": "no disponible",
  "panel.notRecorded": "no registrado",
};

const CATALOGUES: Record<Locale, Record<ViewerMessageKey, string>> = {
  en: ENGLISH,
  es: SPANISH,
};

export type ViewerTranslator = (
  key: ViewerMessageKey,
  parameters?: Record<string, string | number>,
) => string;

/** Translator for `locale`, with `{name}` placeholders. */
export function createViewerTranslator(locale: Locale): ViewerTranslator {
  const catalogue = CATALOGUES[locale];
  return (key, parameters = {}) =>
    catalogue[key].replaceAll(/\{(\w+)\}/gu, (match, name: string) =>
      name in parameters ? String(parameters[name]) : match,
    );
}

/** The text of a `CHECK` or `DEFAULT` expression, or why it is missing, e.g. "not available". */
export function describeDefinition(definition: Definition, t: ViewerTranslator): string {
  return (
    definitionText(definition) ??
    t(isUnknownDefinition(definition) ? "panel.notRecorded" : "panel.notAvailable")
  );
}

/** Plural-aware key for a count, e.g. `summary.tables.one` or `summary.tables.other`. */
export function pluralKey(
  base: "summary.tables" | "summary.views" | "summary.relations",
  count: number,
): ViewerMessageKey {
  return count === 1 ? `${base}.one` : `${base}.other`;
}
