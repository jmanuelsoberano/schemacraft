import type { Locale } from "@/shared/i18n/locales";

/** The viewer's own small catalogue; it must not pull the application's stores. */
const ENGLISH = {
  "search.placeholder": "Search tables",
  "search.empty": "No tables match",
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
} as const;

export type ViewerMessageKey = keyof typeof ENGLISH;

const SPANISH: Record<ViewerMessageKey, string> = {
  "search.placeholder": "Buscar tablas",
  "search.empty": "Ninguna tabla coincide",
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

/** Plural-aware key for a count, e.g. `summary.tables.one` or `summary.tables.other`. */
export function pluralKey(
  base: "summary.tables" | "summary.views" | "summary.relations",
  count: number,
): ViewerMessageKey {
  return count === 1 ? `${base}.one` : `${base}.other`;
}
