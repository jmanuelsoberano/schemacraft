# Microsoft Store listing and certification draft

This document preserves the original 1.2 submission material as a historical record. Its
status statements describe that preparation date, not the current Partner Center dashboard.
The [1.3.0 draft](#130-listing-and-reviewer-draft) below is separate review material; preparing
it does not change the published 1.2.0 package, upload a package or submit an update.

## Historical 1.2 submission material - 2026-10-22

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

## 1.3.0 listing and reviewer draft

Prepared on **2026-10-23** for review against the combined 1.3.0 candidate. The maintainer
accepted the four-feature candidate and selected 1.3.0; this does not establish acceptance of
the final versioned package or its Store update path. The English and Spanish copy below
replaces the historical product description only when the maintainer prepares a new Store
submission. Retain the existing product identity, free price and required en-US/es-ES locales;
recheck the audience, markets, rating, privacy/license links, media and publication controls
against that submission. No Partner Center fields are changed by this document.

### English 1.3.0 listing copy

#### Short description

Explore SQL Server and PostgreSQL schemas, compare captures and share diagrams.

#### Description

SchemaCraft helps you understand and document SQL Server and PostgreSQL databases. Capture
schema metadata with your authorized database login, then explore and share saved projects
without a live connection. Microsoft Edge WebView2 Runtime is required.

Explore tables, views, columns, keys, indexes and constraints in interactive diagrams. Inspect
procedure parameters, function results, triggers and readable SQL definitions. PostgreSQL
definitions are reconstructed from its catalogs; unavailable facts and capture limitations
remain visible.

Compare two saved projects with a filtered change list, before/after details, diagram context
and differences between available source lines. Explore known dependencies through Inspector
lists and a separate object map. Catalog references do not provide complete runtime impact
analysis: dynamic SQL, application code and some routine-body references may be missing.

Save named perspectives with independent layouts and visible objects, a description, and
shared table/column notes. Review a database refresh before applying it to the project.
Export diagrams and visible dependency maps to SVG, PNG, single-page PDF or self-contained
interactive HTML; export a filtered comparison as an HTML report.

Captured module bodies stay out of exports. Diagram exports include notes only when you
explicitly select and review them for that export; comparison reports do not include notes.
Visible schema metadata and structural expressions such as CHECK and DEFAULT may be included.
Review every project and export before sharing it.

Prepare an optional local diagnostic text file from **Report a problem…**, review it, and open the
public GitHub bug form separately. Diagnostics include basic application/runtime information
and up to seven available log files, without collecting projects, preferences or stored
credentials. Nothing is uploaded and no report is submitted automatically.

SchemaCraft reads database metadata; it does not edit source database schemas or execute
captured SQL code. Work in English or Spanish, with light and dark themes and keyboard
navigation. No SchemaCraft account is required; submitting a GitHub issue requires GitHub.

#### Features

- Offline project comparison with before/after facts, diagram context and local source-line differences.
- Known-dependency lists and a separate object map with explicit coverage and unresolved references.
- Saved perspectives, independent layouts, descriptions and shared table/column notes.
- Native PostgreSQL support, including materialized views, overloaded routines and trigger modes.
- Interactive entity-relationship diagrams, reviewed refresh, undo/redo and portable projects.
- SVG, PNG, single-page PDF and self-contained HTML exports, with explicit note selection.
- Optional diagnostic preview/save and a separately opened GitHub bug form.

#### System requirements and compatibility

- Windows 10 build 19041 or later, or Windows 11; x64 and Microsoft Edge WebView2 Runtime.
  The package does not bundle the runtime.
- Live capture/refresh requires access to an authorized database. SQL Server 2019/2022 and
  PostgreSQL 15–18 have integration coverage. SQL Server 2016/2017 remain best effort without
  automated tests. This test matrix does not establish every authentication or Store update path.
- PostgreSQL uses certificate and hostname verification by default and accepts a custom public
  certificate authority. Use connection settings appropriate to your database environment.
- Existing format-1/2/3 projects migrate in memory when opened. New saves use format 4 and
  require minimum reader 4. SchemaCraft 1.2.0 and earlier cannot open those new files; keep
  original copies if you need to use an older application version.

#### What's new in 1.3.0

Compare saved projects, explore known dependencies, save perspectives and shared notes, and
inspect PostgreSQL natively. Review and save an optional diagnostic file before opening a bug
report. New saves use project format 4; keep an older copy when compatibility with 1.2.0 matters.

### Spanish 1.3.0 listing copy

#### Short description

Explora SQL Server y PostgreSQL, compara capturas y comparte diagramas.

#### Description

SchemaCraft te ayuda a comprender y documentar bases de datos de SQL Server y PostgreSQL.
Captura los metadatos con un inicio de sesión autorizado y después explora y comparte los
proyectos guardados sin conexión a la base de datos. Se necesita Microsoft Edge WebView2 Runtime.

Explora tablas, vistas, columnas, claves, índices y restricciones en diagramas interactivos.
Consulta parámetros de procedimientos, resultados de funciones, desencadenadores y definiciones
SQL legibles. Las definiciones de PostgreSQL se reconstruyen a partir de sus catálogos; los
datos no disponibles y las limitaciones de la captura se indican expresamente.

Compara dos proyectos guardados con una lista filtrable de cambios, detalles antes/después,
ubicación en el diagrama y diferencias entre las líneas de código disponibles. Explora las
dependencias conocidas en las listas del Inspector y en un mapa de objetos independiente.
Las referencias del catálogo no son un análisis completo del impacto en ejecución: pueden
faltar referencias de SQL dinámico, código de aplicaciones y algunos cuerpos de rutinas.

Guarda perspectivas con distribución y objetos visibles independientes, una descripción y
notas compartidas de tablas y columnas. Revisa los cambios antes de actualizar el proyecto
desde la base de datos. Exporta diagramas y mapas de dependencias visibles a SVG, PNG, PDF de
una página o HTML interactivo autocontenido; exporta una comparación filtrada como informe HTML.

Los cuerpos de los módulos capturados quedan fuera de las exportaciones. Las exportaciones de
diagramas incluyen notas únicamente cuando las seleccionas y revisas para esa exportación;
los informes de comparación no incluyen notas. Pueden incluirse metadatos visibles y
expresiones estructurales como CHECK y DEFAULT. Revisa cada proyecto y exportación antes de
compartirlos.

Desde **Reportar un problema…** puedes preparar un archivo de diagnóstico local opcional,
revisarlo y abrir por separado el formulario público de errores de GitHub. El diagnóstico
incluye información básica de la aplicación y su entorno y hasta siete registros disponibles;
no recopila proyectos, preferencias ni credenciales guardadas. No se suben archivos ni se
envían reportes automáticamente.

SchemaCraft lee metadatos; no modifica los esquemas de las bases de datos ni ejecuta el código
SQL capturado. Trabaja en español o inglés, con temas claro y oscuro y navegación por teclado.
No necesitas una cuenta de SchemaCraft; para enviar un reporte en GitHub necesitas una de GitHub.

#### Features

- Comparación de proyectos sin conexión, con datos antes/después, ubicación y diferencias de código.
- Listas y mapa de dependencias conocidas, con cobertura y referencias sin resolver explícitas.
- Perspectivas guardadas, distribuciones independientes, descripciones y notas compartidas.
- PostgreSQL nativo, incluidas vistas materializadas, rutinas sobrecargadas y modos de desencadenadores.
- Diagramas de entidad-relación interactivos, actualización revisada, deshacer/rehacer y proyectos portables.
- Exportación a SVG, PNG, PDF de una página y HTML autocontenido, con selección expresa de notas.
- Vista previa y guardado de diagnóstico opcional y apertura independiente del formulario de GitHub.

#### System requirements and compatibility

- Windows 10, compilación 19041 o posterior, o Windows 11; x64 y Microsoft Edge WebView2 Runtime.
  El paquete no incluye ese componente.
- Para capturar o actualizar necesitas acceso autorizado a una base de datos. Hay pruebas de
  integración con SQL Server 2019/2022 y PostgreSQL 15–18. SQL Server 2016/2017 se admiten sin
  pruebas automáticas. Esta matriz no demuestra todas las formas de autenticación ni la
  actualización desde Microsoft Store.
- PostgreSQL verifica el certificado y el nombre del servidor de forma predeterminada y admite
  una autoridad certificadora pública adicional. Usa la configuración adecuada para tu entorno.
- Los proyectos de formatos 1/2/3 se migran en memoria al abrirlos. Los nuevos guardados usan
  formato 4 y requieren un lector mínimo 4. SchemaCraft 1.2.0 y las versiones anteriores no
  pueden abrir esos archivos; conserva los originales si necesitas utilizar una versión anterior.

#### What's new in 1.3.0

Compara proyectos guardados, explora dependencias conocidas, guarda perspectivas y notas
compartidas y consulta PostgreSQL de forma nativa. Revisa y guarda un diagnóstico opcional
antes de abrir un reporte. Los nuevos guardados usan formato 4; conserva una copia anterior
cuando necesites compatibilidad con 1.2.0.

### Proposed 1.3.0 runFullTrust justification

SchemaCraft uses its native Rust/Tauri desktop host at the current user's normal privilege
level to connect to a user-selected SQL Server or PostgreSQL database and read catalog metadata
and optionally readable module definitions. It opens/saves user-selected projects, exports
reviewed diagrams/reports through native dialogs, and maintains local preferences/logs.
Optionally remembered passwords use Windows Credential Manager; project/configuration files
do not store connection passwords. Diagnostic preparation is local and optional; the user
reviews and attaches a saved file manually if desired. The host does not execute captured
module code, request elevation, install a service/driver or upload telemetry/diagnostics.

The existing `packagedClassicApp`, `mediumIL` and `runFullTrust` declarations remain the
packaging boundary. This justification does not claim certification or credential/update
acceptance for the future 1.3.0 package.

### Proposed 1.3.0 reviewer steps

Use the final package selected for submission and record its version/hash and Windows
environment. These are proposed instructions, not a completed certification or update test.
Only use reviewer-controlled synthetic projects/databases and disposable credentials. No
public database endpoint or review account is supplied. Confirm the final test arrangement
and current UI labels before entering these notes in Partner Center.

1. Launch the packaged application and check **About SchemaCraft** (F1) reports 1.3.0. Exercise English/light
   and Spanish/dark. No SchemaCraft login or database connection is needed to open a project.
2. Copy the [historical format-2 sample](../crates/schemacraft-core/src/project/fixtures/format-2.scraft)
   to a writable folder, retain the original, and open the copy without connecting. Inspect
   columns, relationships and its expected partial-access/retained notices. Save under a new
   name and reopen: the new file uses format 4/minimum reader 4. The old sample cannot prove
   source capture or known dependencies; absent newer facts must remain unrecorded. Do not
   refresh its recorded fixture connection. Older applications cannot open the newly saved file.
3. From **Explore → Manage perspectives**, create a named perspective, change its visible
   selection/layout, add a description and shared table/column notes, duplicate and rename it,
   then switch to **General** and back. Try undo/redo and save/reopen. Shared notes remain
   shared; curated maps keep their selections. Export once with notes off, then with only
   explicitly reviewed visible notes/description. Inspect each format, including HTML offline.
4. Use **Explore → Compare projects** with the original sample and the newly saved copy.
   Inspect Reference/Compared, swap sides and filters without replacing the open project.
   Layout/note-only changes do not become schema changes; historical evidence is qualified.
   Export a filtered HTML report, open it separately offline, and verify its scope and the
   absence of notes and module bodies.
5. For live checks, the reviewer must supply an authorized synthetic SQL Server 2019/2022 or
   PostgreSQL 15–18 environment. Existing fixtures are the SQL Server
   [code](../crates/schemacraft-core/tests/fixtures/sqlserver/code.sql) and
   [dependencies](../crates/schemacraft-core/tests/fixtures/sqlserver/dependencies.sql) scripts
   and the [PostgreSQL fixture](../crates/schemacraft-core/tests/fixtures/postgresql/fixture.sql).
   An environment owner must review and prepare them outside SchemaCraft, only in disposable
   instances: fixtures can recreate databases/schemas and change test permissions. The
   [PostgreSQL fixture guide](../dev/postgresql/README.md) describes its isolated TLS setup;
   its automated suite is not a required action for a certification reviewer.
6. In a new connection choose the engine and correct certificate/hostname verification for
   that test server. Leave Remember password off initially. Capture native metadata and known
   dependencies with **Read known dependencies** on and source saving off, then save/reopen.
   Inspect **Depends on** and **Used by** and open **Explore known dependencies**. Navigate
   direct references and known paths; inspect limitations and unresolved/unsupported targets.
   Hide one map object and export the visible map in each format. The hidden object and
   module bodies must not be embedded. Do not interpret missing edges as proof of no impact.
7. Repeat capture with source saving enabled. Inspect readable routine/view/trigger definitions
   and unavailable states. For PostgreSQL inspect materialized views, overloaded routines,
   function return columns, native index/constraint states and trigger modes. Definitions are
   reconstructed and routine-body dependency coverage is qualified. Refresh an unchanged
   test database and review the result before applying; enabling a previously unrecorded
   metadata family must not be described as a confirmed database addition.
8. To exercise source differences, obtain two captures around an owner-controlled change in
   that disposable database. Compare them, review before/after facts and the original source
   line differences; inaccessible source must not appear as empty code. Export the filtered
   comparison: it records source-change metadata, without the module text. The app must leave
   the current project, input files and database unchanged during comparison.
9. Open **About SchemaCraft → Report a problem…** without a database connection. Review the preview and
   optionally **Save diagnostic file…** to a local `.txt`, then compare its contents with the
   preview. No projects/preferences/credentials are collected. **Open bug report on GitHub**
   opens the public form with version 1.3.0; inspect it without submitting or attaching a file.
   No diagnostic upload or issue creation occurs automatically.
10. Test the package's installed-state behavior separately with disposable state: restart,
    remembered test credentials, project reopen and the actual update from installed 1.2.0
    in the same package family. Record data/credential preservation and uninstallation results
    under the [Store acceptance gates](microsoft-store.md#acceptance-gates). A successful
    portable build, manifest validation or same-version reinstall does not pass those gates.
    Windows authentication needs its own authorized Windows SQL setup; SQL-login/PostgreSQL
    success does not establish it.

Before a maintainer-run app session, back up preferences and isolate any existing WebView
profile opaquely. Restore originals after confirmed process exit and verify the preference
hash. Keep logs, screenshots and notes synthetic, and review them before sharing. New 1.3.0
screenshots, final privacy/license wording, actual package/channel acceptance and publication
controls remain submission review items; no approval or new public availability is claimed.

### 1.3.0 screenshot set

The maintainer selected **ten distinct scenes per language: five light and five dark**.
The same scenes were captured in English and Spanish, giving twenty 1920 × 1080 PNG files.
All twenty images come from the built 1.3.0 application with synthetic fixtures and were
inspected at full size.
The local gallery includes their dimensions, byte sizes and SHA-256 hashes. This is media
preparation and review; no image was uploaded or published. Historical 1.2 images remain separate.

The [Microsoft screenshot guidance](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/screenshots-and-images)
allows up to ten desktop screenshots per language. Use PNGs at least 1366 × 768 and below
50 MB each; captions must not exceed 200 characters. Do not add marketing text or graphical
overlays. The prepared captions below remain below that limit in both languages.

| ID  | Scene                                                          | Theme | English caption                                                                                                         | Spanish caption                                                                                                                 |
| --- | -------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 01  | SQL Server entity-relationship diagram                         | Light | Explore SQL Server tables, views and relationships in an interactive diagram.                                           | Explora tablas, vistas y relaciones de SQL Server en un diagrama interactivo.                                                   |
| 02  | Inspector with columns and rule explanation                    | Dark  | Inspect columns and supported rule explanations, with their SQL available for review.                                   | Consulta columnas y explicaciones de reglas compatibles, con su SQL disponible para revisión.                                   |
| 03  | Routine metadata and read-only code viewer                     | Light | Read routine parameters and available SQL definitions without executing the captured code.                              | Consulta parámetros de rutinas y definiciones SQL disponibles sin ejecutar el código capturado.                                 |
| 04  | Project comparison with before/after facts and diagram context | Dark  | Compare two saved captures with filters, before-and-after facts and diagram context.                                    | Compara dos capturas guardadas con filtros, datos antes y después y ubicación en el diagrama.                                   |
| 05  | Source-line comparison                                         | Light | Review differences between available source lines. Definition text changes do not prove semantic changes.               | Revisa diferencias entre las líneas de código disponibles. Un cambio de texto no demuestra un cambio semántico.                 |
| 06  | Known-dependency map and its coverage                          | Dark  | Follow known object dependencies and inspect coverage limits; missing edges do not prove no impact.                     | Sigue dependencias conocidas entre objetos y revisa su cobertura; la ausencia de conexiones no demuestra que no haya impacto.   |
| 07  | Named perspectives, description and shared notes               | Light | Save separate perspectives over one schema, with descriptions and shared table or column notes.                         | Guarda perspectivas independientes del mismo esquema, con descripciones y notas compartidas de tablas o columnas.               |
| 08  | PostgreSQL native metadata in the Inspector                    | Dark  | Inspect PostgreSQL columns, native types and constraints, with explicit capture limits.                                 | Consulta columnas, tipos y restricciones nativas de PostgreSQL, con límites de captura explícitos.                              |
| 09  | Export review with explicit note selection                     | Light | Review visible content and select notes for each diagram export to SVG, PNG, PDF or interactive HTML.                   | Revisa el contenido visible y selecciona las notas de cada exportación a SVG, PNG, PDF o HTML interactivo.                      |
| 10  | Optional diagnostic preview and separate report action         | Dark  | Review and optionally save a local diagnostic file. Open the GitHub bug form separately; nothing uploads automatically. | Revisa y guarda opcionalmente un diagnóstico local. Abre el formulario de GitHub por separado; no se sube nada automáticamente. |

Use names such as `01-erd-light-en.png` and `01-erd-light-es.png`, maintaining the same scene
and theme across locales. For each final file record dimensions, byte size, SHA-256, language,
theme, application version and synthetic scenario. Inspect the complete image at its intended
display size: no clipped controls, private connection history, passwords, user paths or
unreviewed notifications. Keep any visible fixture identifiers synthetic. A code-viewer image
may show synthetic source inside the application; diagram/report exports still exclude module
bodies. Media review does not establish Store certification, installation or update acceptance.
