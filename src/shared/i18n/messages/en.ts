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

  "canvas.loaded.one": "{count} entity loaded. The diagram arrives in the next milestone.",
  "canvas.loaded.other": "{count} entities loaded. The diagram arrives in the next milestone.",

  "statusBar.notConnected": "Not connected",
  "statusBar.connected": "{target} · {database}",
  "statusBar.tables.one": "{count} table",
  "statusBar.tables.other": "{count} tables",
  "statusBar.views.one": "{count} view",
  "statusBar.views.other": "{count} views",
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

  "action.saveProjectAs": "Save project as…",
  "project.unsavedChanges": "Unsaved changes",
  "project.dialog.open": "Open project",
  "project.dialog.save": "Save project as",
  "project.discard.title": "Discard unsaved changes?",
  "project.discard.description": "{name} has changes that are not saved yet.",
  "project.discard.note": "Save the project first if you want to keep them.",
  "project.discard.confirm": "Discard changes",
  "project.discard.cancel": "Keep editing",
  "project.notice.openFailed": "The project could not be opened",
  "project.notice.saveFailed": "The project could not be saved",
  "project.notice.dismiss": "Dismiss",

  "welcome.recent.title": "Recent projects",
  "welcome.recent.open": "Open {name}",

  "connection.recent.title": "Recent connections",
  "connection.recent.use": "Fill the form with {target}",
  "connection.recent.remove": "Remove {target} from the history",
  "connection.recent.windows": "Windows Authentication",
  "connection.refresh.title": "Refresh from database",
  "connection.refresh.description":
    "Read the schema of {database} again. Changes are reviewed before they are applied, and the positions of unchanged tables are kept.",
  "connection.refresh.passwordHint": "Enter the password to reconnect.",

  "review.title": "Review changes in {database}",
  "review.description":
    "Nothing is applied until you confirm. Positions of unchanged tables are kept.",
  "review.empty.title": "The project is up to date",
  "review.empty.description": "The database schema matches the project.",
  "review.summary.added.one": "{count} added",
  "review.summary.added.other": "{count} added",
  "review.summary.removed.one": "{count} removed",
  "review.summary.removed.other": "{count} removed",
  "review.summary.changed.one": "{count} changed",
  "review.summary.changed.other": "{count} changed",
  "review.section.tables": "Tables",
  "review.section.views": "Views",
  "review.section.foreignKeys": "Relations",
  "review.change.added": "Added",
  "review.change.removed": "Removed",
  "review.change.changed": "Changed",
  "review.columns.one": "{count} column",
  "review.columns.other": "{count} columns",
  "review.primaryKey": "Primary key",
  "review.index": "Index",
  "review.checkConstraint": "Check",
  "review.property.dataType": "Type",
  "review.property.nullability": "Nullable",
  "review.property.defaultExpression": "Default",
  "review.property.identity": "Identity",
  "review.property.computed": "Computed",
  "review.property.referencedTable": "References",
  "review.property.columns": "Columns",
  "review.property.onDelete": "On delete",
  "review.property.onUpdate": "On update",
  "review.property.enabled": "Enabled",
  "review.value.yes": "yes",
  "review.value.no": "no",
  "review.value.none": "none",
  "review.action.apply": "Apply changes",
  "review.action.discard": "Discard",
  "review.action.close": "Close",
  "review.status.applying": "Applying…",

  "referentialAction.noAction": "no action",
  "referentialAction.cascade": "cascade",
  "referentialAction.setNull": "set null",
  "referentialAction.setDefault": "set default",
  "indexKind.uniqueConstraint": "unique constraint",
  "indexKind.uniqueIndex": "unique index",
  "indexKind.nonUnique": "index",
  "indexKind.clustered": "clustered",

  "error.project.notFound.title": "The project file was not found",
  "error.project.notFound.hint":
    "It may have been moved or deleted, so it was removed from the recent projects.",
  "error.project.read.title": "The project file could not be read",
  "error.project.read.hint": "Check that the file is accessible and not locked by another program.",
  "error.project.write.title": "The project file could not be written",
  "error.project.write.hint": "Check that the folder exists and that you can write to it.",
  "error.project.notAProject.title": "Not a SchemaCraft project",
  "error.project.notAProject.hint": "The file is not a .scraft project, or it is damaged.",
  "error.project.unsupportedFormatVersion.title": "Newer project format",
  "error.project.unsupportedFormatVersion.hint":
    "The file was saved by a newer SchemaCraft. Update the application to open it.",
  "error.preferences.read.title": "Preferences could not be read",
  "error.preferences.read.hint": "The history stays empty until the file can be read again.",
  "error.preferences.write.title": "Preferences could not be saved",
  "error.preferences.write.hint":
    "The history may not survive a restart. Check the permissions of the configuration folder.",
  "error.preferences.corrupt.title": "Preferences are damaged",
  "error.preferences.corrupt.hint": "The file is replaced on the next change.",

  "connection.field.rememberPassword": "Remember password",
  "connection.field.rememberPassword.description":
    "Kept by the Windows Credential Manager, never in project files.",
  "connection.password.stored": "A remembered password will be used. Type one to replace it.",
  "error.storedPasswordMissing.title": "The remembered password is gone",
  "error.storedPasswordMissing.hint": "Type the password again to reconnect.",
  "error.credentialStoreFailed.title": "The credential store could not be read",
  "error.credentialStoreFailed.hint": "Type the password to continue. The details may say why.",
  "error.credential.unavailable.title": "Passwords cannot be remembered here",
  "error.credential.unavailable.hint":
    "This platform has no credential store, so the password is typed each time.",
  "error.credential.storeFailed.title": "The credential store failed",
  "error.credential.storeFailed.hint": "The password was not remembered. The details may say why.",
  "error.invalidArgument.title": "That cannot be done",
  "error.invalidArgument.hint": "The application asked for something impossible. Please report it.",
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
