# Microsoft Store listing and certification draft

**Listing copy and reviewer material.** The first private SchemaCraft 1.2 submission entered
Microsoft's certification workflow on **2026-10-22**. The required EN/ES listings were complete;
the optional reviewer notes below were not saved because of a portal error and were omitted
with the maintainer's authorization. Neither certification approval nor public availability is
claimed. English and Spanish sections below are user-facing copy; the rest is review guidance.
Account identity, screenshots, markets, ratings, package acceptance and publication remain
governed by the [Store preparation guide](microsoft-store.md).

## Proposed listing fields

| Field                                    | Draft value or status                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Product name                             | SchemaCraft; reserved in Partner Center                                                     |
| Category                                 | Developer tools; confirmed by the maintainer                                                |
| Price                                    | Free, confirmed by the maintainer                                                           |
| License                                  | AGPL-3.0-only; preserve the existing license and corresponding source links                 |
| Listing languages                        | English (United States) and Spanish (Spain); neutral EN/ES copy, as required by the package |
| Publisher, Store ID and package identity | Verified values are recorded in the Store preparation guide                                 |
| Age rating and markets                   | IARC ratings saved; all markets, private audience for the maintainer's account              |

The known public links available for review are the [project repository](https://github.com/jmanuelsoberano/schemacraft),
[privacy policy](https://github.com/jmanuelsoberano/schemacraft#privacy-policy),
[issue tracker](https://github.com/jmanuelsoberano/schemacraft/issues) and
[license](../LICENSE). Review the privacy wording and public issue-reporting implications before
choosing the final listing links. The Store product is in private certification review; these
links do not create a support service or establish public Store availability.

## English listing copy

### Short description

Explore SQL Server schemas, inspect SQL code and export database diagrams.

### Description

SchemaCraft helps you understand and document Microsoft SQL Server databases. Live capture
requires access to a SQL Server instance; saved projects can be opened without a database
connection. Microsoft Edge WebView2 Runtime is required.

Read tables, views, columns, keys, indexes and constraints, then explore their relationships in
an interactive diagram. Inspect stored procedures, functions, triggers and view definitions
when your login can read them. Missing permissions and unavailable definitions are identified
instead of being treated as absent objects.

Keep the schema and diagram together in a `.scraft` project. Arrange the diagram, review changes
before refreshing from the server, and export the visible diagram as SVG, PNG, PDF or an
interactive HTML file. Work in English or Spanish, with light and dark themes.

SchemaCraft reads database metadata; it does not edit database schemas or execute the captured
SQL code. Saved projects may include confidential names and SQL definitions. Diagram exports
exclude captured module bodies but can include visible schema metadata. Review files before
sharing them.

### Features

- Interactive entity-relationship diagrams with three detail levels and automatic layouts.
- Tables, views, keys, indexes and constraints, with explanations for supported database rules.
- Procedure parameters, function return structure, trigger details and a read-only SQL viewer.
- Portable projects that reopen offline and preserve layout when reviewing a database refresh.
- SVG, PNG, single-page PDF and self-contained interactive HTML exports.
- English and Spanish interfaces, light and dark themes, and keyboard navigation.
- SQL Server login and Windows authentication options; optional password storage in Windows
  Credential Manager.

### System requirements and notes

- Windows 10 build 19041 or later, or Windows 11; x64.
- Microsoft Edge WebView2 Runtime; it is not bundled with this package.
- For live capture or refresh: network access to SQL Server and an authorized login. SQL Server
  2019 and 2022 are the tested engine versions in the existing release; 2016 and 2017 are
  supported on a best-effort basis without automated tests.
- No SchemaCraft account is required. Opening an existing `.scraft` project does not require
  a SQL connection. Installation and updates through Microsoft Store are handled by Microsoft.

### What's new in 1.2

Inspect stored procedures, functions, triggers and view code; retain definitions you can no
longer verify during a refresh; and see trigger details in the diagram and HTML viewer. Index
and constraint states improve relationship explanations. Local diagnostic logs help investigate
problems and are not uploaded automatically.

## Spanish listing copy

### Short description

Explora esquemas de SQL Server, consulta su código y exporta diagramas.

### Description

SchemaCraft te ayuda a comprender y documentar bases de datos de Microsoft SQL Server. La
captura requiere acceso a una instancia de SQL Server; los proyectos guardados se pueden abrir
sin conexión a la base de datos. Se necesita Microsoft Edge WebView2 Runtime.

Lee tablas, vistas, columnas, claves, índices y restricciones, y explora sus relaciones en un
diagrama interactivo. Consulta procedimientos almacenados, funciones, desencadenadores y
definiciones de vistas cuando tu inicio de sesión permita leerlos. Los permisos insuficientes
y las definiciones no disponibles se indican sin confundirlos con objetos que no existen.

Guarda el esquema y el diagrama en un archivo `.scraft`. Organiza el diagrama, revisa los cambios
antes de actualizarlo desde el servidor y exporta los objetos visibles a SVG, PNG, PDF o HTML
interactivo. Trabaja en español o inglés, con temas claro y oscuro.

SchemaCraft lee metadatos; no modifica el esquema de la base de datos ni ejecuta el código SQL
capturado. Los proyectos pueden contener nombres y definiciones SQL confidenciales. Las
exportaciones excluyen el cuerpo de los módulos capturados, pero pueden incluir metadatos
visibles del esquema. Revisa los archivos antes de compartirlos.

### Features

- Diagramas de entidad-relación interactivos con tres niveles de detalle y distribución automática.
- Tablas, vistas, claves, índices y restricciones, con explicaciones de las reglas compatibles.
- Parámetros de procedimientos, estructura de retorno de funciones, detalles de desencadenadores
  y un visor SQL de solo lectura.
- Proyectos portables que se abren sin conexión y conservan la distribución al revisar una actualización.
- Exportación a SVG, PNG, PDF de una página y HTML interactivo autocontenido.
- Interfaz en español e inglés, temas claro y oscuro, y navegación por teclado.
- Opciones de autenticación de SQL Server y Windows; almacenamiento opcional de contraseñas en
  el Administrador de credenciales de Windows.

### System requirements and notes

- Windows 10, compilación 19041 o posterior, o Windows 11; x64.
- Microsoft Edge WebView2 Runtime; este paquete no lo incluye.
- Para capturar o actualizar: acceso de red a SQL Server y un inicio de sesión autorizado.
  SQL Server 2019 y 2022 son las versiones probadas en la distribución existente; 2016 y 2017
  se admiten sin pruebas automáticas.
- No necesitas una cuenta de SchemaCraft. Abrir un proyecto `.scraft` existente no requiere
  conexión a SQL Server. Microsoft gestiona la instalación y las actualizaciones de su tienda.

### What's new in 1.2

Consulta procedimientos almacenados, funciones, desencadenadores y código de vistas; conserva
las definiciones que ya no puedas comprobar al actualizar; y revisa los desencadenadores en el
diagrama y en el visor HTML. Los estados de índices y restricciones mejoran las explicaciones
de las relaciones. Los registros de diagnóstico locales ayudan a investigar problemas y no se
envían automáticamente.

## Proposed runFullTrust justification

SchemaCraft is an existing desktop application with a native Rust/Tauri host. It requests
`runFullTrust` to run that host at the current user's normal privilege level. The host connects
to the SQL Server explicitly chosen by the user and reads database metadata and, when selected,
module definitions. It opens and saves user-selected `.scraft` projects, writes diagram exports
through native file dialogs, and maintains local preferences and diagnostic files.

When the user opts in to Remember password, the host uses Windows Credential Manager to store
and retrieve that SQL login's password; the user can forget it through the application. It does
not store connection passwords in projects or preferences. Captured SQL definitions are source
text and may themselves contain sensitive material, as the privacy policy explains.

The package declares `packagedClassicApp` and `mediumIL`; it does not request elevation or
install a Windows service or driver. The application has no telemetry or automatic diagnostic
upload. Store signing and updates are separate from the application's functionality.

This text explains the declared capability. It is not evidence that Microsoft has approved it
or that credential access under the final package identity has passed acceptance.

## Certification material and proposed reviewer steps

Use the actual package submitted for certification. These are instructions to execute, not a
record of completed Store tests. Windows-authentication acceptance under package identity is
still pending; the listing's authentication wording must be reviewed with that result.

### Existing synthetic offline sample

The repository already contains
[`crates/schemacraft-core/src/project/fixtures/format-2.scraft`](../crates/schemacraft-core/src/project/fixtures/format-2.scraft).
It is a synthetic project saved by SchemaCraft 1.1.0, with six tables, one view and six foreign
keys. `sales.RecentOrders` is initially hidden. The sample intentionally records partial access
and retained facts, so those notices are expected. Its recorded local connection is fixture
metadata, not a working reviewer account; opening the file does not connect to that server.

The prepared reviewer notes include the [direct sample download](https://raw.githubusercontent.com/jmanuelsoberano/schemacraft/v1.2.0/crates/schemacraft-core/src/project/fixtures/format-2.scraft).
Partner Center failed to save those notes, so this instruction was not delivered with the first
private submission. Retain it for reviewer follow-up; no new sample, attachment or hosted
endpoint is created by this document.

1. Copy the existing sample to a user-writable test folder and retain the original unchanged.
   Use **Open project** to open the copy without configuring a database connection.
2. Inspect `sales.Orders` and `sales.OrderLines`. Switch between Compact, Keys and Full detail;
   select a table to inspect columns and relationships. Check the stored partial-access notices.
3. Use the Objects panel to reveal `sales.RecentOrders`, then move a table and try undo/redo.
   Switch the interface between English/light and Spanish/dark.
4. Use **Save project as…** to save a new file, close it and reopen it. Check the chosen layout
   and visible objects. Saving this older project upgrades the copy to the current format.
5. Export SVG, PNG, PDF and HTML to the test folder. Open the HTML in a separate browser and
   inspect a table; check that the exports show the chosen visible objects.
6. This format-2 sample has no captured procedure, function, trigger or view source. Missing
   newer facts should be shown as not recorded, not invented. Do not use this sample as proof
   of live capture, refresh or SQL code reading, and do not refresh its stored connection.

### Optional live capture with a reviewer-controlled SQL Server

This path requires the reviewer's own authorized SQL Server 2019 or 2022 and synthetic data.
The project supplies no public database, server endpoint, password or hosted demo login. If a
reviewer cannot provide this environment, the maintainer must agree an appropriate live-testing
arrangement with certification; the offline sample does not close that requirement.

The existing synthetic module fixture is
[`crates/schemacraft-core/tests/fixtures/sqlserver/code.sql`](../crates/schemacraft-core/tests/fixtures/sqlserver/code.sql).
It recreates its named test database and is intended for an isolated disposable SQL instance.
The server owner must review it before choosing to seed it; do not run it against an existing
database containing useful data. Fixture setup is outside SchemaCraft and is not performed by
these reviewer instructions.

1. In **New connection**, enter the reviewer-controlled server and authorized login. Use SQL
   login for the initial path and leave Remember password off. Choose encryption and certificate
   settings appropriate to that test server; this draft supplies no connection details.
2. Select the synthetic database and the objects to read. Enable reading procedures, functions
   and triggers and saving their code. Complete the capture.
3. If the existing code fixture was selected, inspect `app.Orders`, its triggers,
   `app.OpenOrders`, and `app.usp_PlaceOrder`. Check procedure parameters and the read-only code
   viewer's find and copy actions. Unavailable or encrypted text must have its stated status.
4. Save a project, close it and reopen it offline. Export HTML and inspect its trigger metadata;
   the export must not contain captured module bodies. Refresh against the same unchanged test
   database and inspect the review before applying it.
5. To review credential storage separately, opt in using only the reviewer's test SQL login,
   restart, reconnect, then forget the stored password. Check that connection passwords do not
   appear in the saved project, preferences or diagnostic log.
6. Windows authentication needs a separately authorized Windows SQL setup. Record whether it
   uses a local account or a domain account and test that specific scope; SQL-login success or
   success in a Linux SQL container does not establish Windows-authentication coverage.

For maintainer-run real-app checks, back up existing preferences before the session, confirm
process termination and restore the original bytes afterward. Keep test projects, accounts and
credential entries synthetic, and record which package and environment were actually tested.

## Review decisions still open

- Review the final EN/ES wording and media against the actual package. The maintainer confirmed
  English (United States) and Spanish (Spain), the two required package locales, with the same
  neutral copy. Additional generic English/Spanish listings are not part of the offer.
- Private audience, zero price, all-market selection and saved IARC ratings were verified for
  the first submission. Recheck them before any subsequent submission or publication action.
  Keep publication held until the maintainer selects Publish now.
- Each required listing has one reviewed 1440x900 synthetic screenshot from the real 1.2.0
  application, with a localized caption. Partner Center marks both listings complete. This
  confirms draft completeness, not certification or installed-MSIX acceptance. Review the
  media again before public availability.
- Confirm the final privacy/license links and address any reviewer request for offline sample
  delivery or live-capture arrangements. A GitHub issue tracker is public and should not receive
  credentials, confidential projects or unredacted logs.
- Complete the package acceptance gates in the main guide before presenting capabilities as
  verified for Store distribution. The verified public Store identity is recorded in that guide;
  no review credentials, approval or availability dates are supplied by this draft.
