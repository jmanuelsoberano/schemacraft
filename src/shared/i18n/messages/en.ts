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
  "sidebar.search.noMatches": 'No entities match "{query}"',
  "sidebar.empty.title": "No entities yet",
  "sidebar.empty.description":
    "Connect to a database or open a .scraft project to list its tables here.",

  "entity.table": "Table",
  "entity.view": "View",
  "entity.columns.one": "{count} column",
  "entity.columns.other": "{count} columns",

  "welcome.title": "Welcome to SchemaCraft",
  "welcome.description":
    "Connect to Microsoft SQL Server, extract the schema and explore it as an interactive entity-relationship diagram.",
  "welcome.connect": "Connect to SQL Server",
  "welcome.openProject": "Open .scraft project",

  "canvas.loaded.one": "{count} table loaded. The diagram arrives in the next milestone.",
  "canvas.loaded.other": "{count} tables loaded. The diagram arrives in the next milestone.",

  "statusBar.notConnected": "Not connected",
  "statusBar.connected": "{target} · {database}",
  "statusBar.tables.one": "{count} table",
  "statusBar.tables.other": "{count} tables",
  "statusBar.relations.one": "{count} relation",
  "statusBar.relations.other": "{count} relations",
  "statusBar.zoom": "Zoom {percent}%",
  "statusBar.version": "v{version}",
  "statusBar.versionUnavailable": "version unavailable",
  "statusBar.devBuild": "dev",

  "connection.dialog.title": "Connect to SQL Server",
  "connection.dialog.description":
    "Read-only access to the catalog. The password stays in memory and is never saved.",
  "connection.section.server": "Server",
  "connection.section.database": "Database",
  "connection.field.server": "Server",
  "connection.field.server.placeholder": "localhost\\SQLEXPRESS or 192.168.1.50,1433",
  "connection.field.server.hint": "Host, host\\instance or host,port. Use . for this machine.",
  "connection.field.server.errorEmpty": "Enter the server name.",
  "connection.field.server.errorPort": "The port must be a number between 1 and 65535.",
  "connection.field.authentication": "Authentication",
  "connection.authentication.integrated": "Windows",
  "connection.authentication.integrated.hint": "Credentials of the current Windows user",
  "connection.authentication.sqlLogin": "SQL Server",
  "connection.authentication.sqlLogin.hint": "A SQL Server login and password",
  "connection.field.username": "Login",
  "connection.field.username.errorEmpty": "Enter the login name.",
  "connection.field.password": "Password",
  "connection.field.encryption": "Encryption",
  "connection.encryption.mandatory": "Mandatory",
  "connection.encryption.optional": "Optional",
  "connection.encryption.strict": "Strict (TDS 8.0)",
  "connection.field.trustCertificate": "Trust the server certificate",
  "connection.field.trustCertificate.description":
    "Skips certificate validation. Only for servers you control.",
  "connection.field.database": "Database",
  "connection.field.database.placeholder": "Choose a database",
  "connection.field.database.hint": "Test the connection to list the databases you can open.",
  "connection.field.schemas": "Schemas",
  "connection.schemas.all": "All schemas",
  "connection.schemas.loading": "Loading schemas…",
  "connection.field.includeViews": "Include views",
  "connection.action.test": "Test connection",
  "connection.action.connect": "Read schema",
  "connection.action.cancel": "Cancel",
  "connection.action.close": "Close",
  "connection.action.trustAndRetry": "Trust the certificate and retry",
  "connection.action.retry": "Retry",
  "connection.status.testing": "Testing the connection…",
  "connection.status.tested.title": "Connected to {server}",
  "connection.status.tested.detail": "{product} · {edition}",
  "connection.progress.title": "Reading the schema of {database}",
  "connection.progress.description":
    "Catalog queries run in parallel, so stages can finish in any order.",
  "connection.progress.cancelling": "Cancelling…",
  "connection.stage.connecting": "Connecting",
  "connection.stage.readingObjects": "Tables and views",
  "connection.stage.readingColumns": "Columns and types",
  "connection.stage.readingIndexes": "Keys and indexes",
  "connection.stage.readingForeignKeys": "Foreign keys",
  "connection.stage.readingConstraints": "Check constraints",
  "connection.stage.assembling": "Assembling the snapshot",

  "error.invalidSettings.title": "Invalid connection settings",
  "error.invalidSettings.hint": "Review the server, login and database fields.",
  "error.unreachable.title": "The server cannot be reached",
  "error.unreachable.hint":
    "Check the server name, that SQL Server is running, that TCP/IP is enabled and that the firewall allows port 1433, or UDP 1434 for named instances.",
  "error.timeout.title": "The connection timed out",
  "error.timeout.hint":
    "The server did not answer in time. Check the network path and the instance name.",
  "error.authenticationFailed.title": "The login was rejected",
  "error.authenticationFailed.hint":
    "Check the login name and password, or use Windows Authentication if your account has access.",
  "error.authenticationFailed.hint.integrated":
    "The server did not accept your Windows account. Check that it has a login there, or switch to SQL Server Authentication.",
  "error.untrustedCertificate.title": "The server certificate is not trusted",
  "error.untrustedCertificate.hint":
    "The server uses a certificate this machine cannot verify, which is common for development instances. Trust it for this connection or install its certificate authority.",
  "error.databaseUnavailable.title": "The database is not available",
  "error.databaseUnavailable.hint": "It does not exist, it is offline or the login cannot open it.",
  "error.connectionRefused.title": "The server refused the session",
  "error.connectionRefused.hint":
    "The network connection worked but the server rejected the login sequence. The details may say why.",
  "error.queryFailed.title": "The catalog could not be read",
  "error.queryFailed.hint":
    "A catalog query failed. The details may say why; report it if it persists.",
  "error.unexpectedCatalogData.title": "Unexpected catalog data",
  "error.unexpectedCatalogData.hint":
    "The server returned data SchemaCraft does not understand. Please report it with the details.",
  "error.cancelled.title": "Cancelled",
  "error.cancelled.hint": "The operation was stopped before it finished.",
  "error.unsupportedOnPlatform.title": "Not supported on this platform",
  "error.unsupportedOnPlatform.hint": "Windows Authentication is only available on Windows.",
  "error.unknownJob.title": "Nothing to cancel",
  "error.unknownJob.hint": "The operation had already finished.",
  "error.ipcUnavailable.title": "Desktop features are unavailable",
  "error.ipcUnavailable.hint":
    "This window runs outside the desktop application. Connect from SchemaCraft itself.",
  "error.unexpected.title": "Something went wrong",
  "error.unexpected.hint": "Try again. If it keeps happening, report it with the details.",
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
