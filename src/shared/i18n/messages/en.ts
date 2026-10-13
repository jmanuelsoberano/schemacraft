/**
 * English catalogue. It is the reference: its keys define the `MessageKey` type, so a message
 * missing from another language fails type-checking instead of showing up blank at runtime.
 */
export const englishMessages = {
  "app.name": "SchemaCraft",
  "app.tagline": "Reverse-engineer SQL Server schemas into living diagrams.",

  "project.untitled": "Untitled project",

  "action.connect": "Connect to SQL Server",
  "action.openProject": "Open project",
  "action.saveProject": "Save project",
  "action.refreshFromDatabase": "Refresh from database",
  "action.autoLayout": "Auto layout",
  "action.export": "Export diagram",
  "action.toggleSidebar": "Toggle entities panel",

  "toolbar.connect": "Connect",

  "common.comingSoon": "Available in an upcoming milestone",

  "menu.theme": "Theme",
  "theme.system": "System",
  "theme.light": "Light",
  "theme.dark": "Dark",

  "menu.language": "Language",
  "language.en": "English",
  "language.es": "Español",

  "viewMode.label": "Detail level",
  "viewMode.compact": "Compact",
  "viewMode.compact.hint": "Table headers only",
  "viewMode.keys": "Keys",
  "viewMode.keys.hint": "Primary and foreign keys",
  "viewMode.full": "Full",
  "viewMode.full.hint": "All columns and types",

  "sidebar.title": "Entities",
  "sidebar.search": "Search tables",
  "sidebar.empty.title": "No entities yet",
  "sidebar.empty.description":
    "Connect to a database or open a .scraft project to list its tables here.",

  "welcome.title": "Welcome to SchemaCraft",
  "welcome.description":
    "Connect to Microsoft SQL Server, extract the schema and explore it as an interactive entity-relationship diagram.",
  "welcome.connect": "Connect to SQL Server",
  "welcome.openProject": "Open .scraft project",

  "statusBar.notConnected": "Not connected",
  "statusBar.tables.one": "{count} table",
  "statusBar.tables.other": "{count} tables",
  "statusBar.relations.one": "{count} relation",
  "statusBar.relations.other": "{count} relations",
  "statusBar.zoom": "Zoom {percent}%",
  "statusBar.version": "v{version}",
  "statusBar.versionUnavailable": "version unavailable",
  "statusBar.devBuild": "dev",
} as const;

export type MessageKey = keyof typeof englishMessages;

export type MessageCatalog = Readonly<Record<MessageKey, string>>;

/** Message keys that come in `one`/`other` plural forms, referred to by their common prefix. */
export type PluralMessageBase = {
  [Key in MessageKey]: Key extends `${infer Base}.one`
    ? `${Base}.other` extends MessageKey
      ? Base
      : never
    : never;
}[MessageKey];
