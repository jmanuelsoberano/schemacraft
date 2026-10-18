# Changelog

All notable changes to SchemaCraft are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A capability probe script, `crates/schemacraft-core/probes/capability-probe.sql`, measures what
  SchemaCraft would read from a SQL Server database and returns numbers only, so a database that
  cannot be shared can still be measured. It is read-only and returns no name and no text; the
  README says how to run it and what to share.

### Changed

- SQL Server 2019 and 2022 are the tested versions: the integration tests run against both on
  every change to the core. SQL Server 2016 and 2017 are supported on a best-effort basis, without
  tests.

## [1.1.0] - 2026-10-18

Logins with limited permissions are explained, tables and views are told apart, an Inspector
panel shows the details of the selected entity, and check constraints and foreign keys read as
sentences. Projects are saved in format 2, which SchemaCraft 1.0 cannot open.

### Added

- Logins with limited permissions are explained instead of producing a diagram that looks
  complete. When a database is chosen, the connection dialog says what the login can read.
  `CHECK` and `DEFAULT` expressions it cannot read show as "not available", and foreign keys to
  tables it cannot see are kept. A status bar indicator, a dismissible notice above the entities
  and an access report (Ctrl+Shift+A) give the cause and a `GRANT VIEW DEFINITION` script to copy
  for the DBA.
- A login that sees no table or view is told so before reading; an empty database shows a
  neutral empty state instead.
- Exports of a diagram read with partial access carry a one-line note saying so.
- Refreshing with a login that sees less keeps what it cannot check and lists it as not checked,
  with the date it was read; what becomes readable, for example after a grant, is listed and
  recorded when the review is applied.
- A refresh reports a `CHECK` constraint that was disabled or enabled again.
- Projects saved by a newer SchemaCraft open read-only when that version allows it: they can be
  rearranged and exported, but not saved or refreshed.
- The entities panel groups tables and views by schema and, inside each schema, in Tables and
  Views sections with their counts. A level that distinguishes nothing is left out, and schemas
  and sections collapse with a chevron for the session; everything is expanded while a search is
  active.
- Views are unmistakable: a VIEW label (VISTA in Spanish), their own icon and colour on the
  canvas, in the entities panel, in the minimap, in the command palette and in every export, SVG,
  PDF, PNG and the HTML viewer included, with the label in the interface language. At the Keys
  level a view is a compact card with its label and column count.
- The command palette and the HTML viewer's search name the kind, Table or View, of every entity.
- An Inspector panel on the right of the canvas shows the selected table or view: columns with
  type, nullability, identity, computed and default, primary key, indexes, `CHECK` constraints
  and the foreign keys in both directions. Every fact the login could not read is marked; values
  not available to this login and tables not visible to it link to the access report with
  "Why?", and a list says "None" only when it is known to be complete. It opens with Ctrl+I, a
  double-click on a card or on an entities row, Enter on a focused card or "Show details" in the
  context menu, and follows the selection. It resizes like the entities panel, by dragging its
  edge or with the arrow keys, Home and End, and remembers its width; in a window too narrow for
  both side panels at their width they narrow, so the canvas and the top bar keep their room.
- Ctrl+1, Ctrl+2 and Ctrl+3 switch the detail level, and the detail levels, the theme and the
  language are commands in the command palette.
- Check constraints and foreign keys read as sentences, in English or Spanish, in the Inspector
  and in the HTML viewer: comparisons, ranges, lists of values, `LIKE` patterns, required values,
  lengths and their combinations, and for a foreign key whether a row must point to another, how
  many rows can point to one row and what deleting or changing it does. Tables are named as
  tables, so every sentence reads right in both languages. A rule over a column that accepts
  NULL applies when it has a value, a disabled rule reads under "When enabled:", and a rule
  SchemaCraft cannot read in full shows its SQL instead of a guess.
- Pointing at a rule, or tabbing to it, highlights its columns on the cards and in the panel and
  its relationship on the canvas, in the app and in the HTML viewer. The SQL behind a rule is one
  click away, with a copy button in the app: a check constraint's stored definition, or for a
  foreign key a statement scripted from the catalog (a key to a table the login cannot see has
  none).
- The hover label of a relationship says what deleting a referenced row does.

### Changed

- "Fit diagram to view" and "Center in view" are now "Fit diagram to window" and "Center on
  screen" ("Ajustar el diagrama a la ventana" and "Centrar en pantalla"), so that "view" only
  means a database view; the command palette and the viewer's search say tables and views.
- The collapse chevron shows only on cards that have rows to hide, so a view at the Keys level
  and a table without key columns no longer offer a toggle that did nothing.
- "Show all entities" in the context menu shows its shortcut.
- The key badges of the HTML viewer take their colours from the application's warning tokens;
  the dark background is a little darker than before.
- The HTML viewer's detail panel shows the same sections as the Inspector, in the same order and
  with the same words, for what is on the exported diagram: relationships to tables left off the
  diagram are not listed, an empty relationship list says "None on the diagram", and there is no
  "Why?" link. It says "None" only when a list is known to be complete; choosing a search result
  or following a relationship moves focus to the panel.
- The Spanish detail levels read "Compacto" and "Completo" ("Compacta" and "Completa" before),
  since they are levels, not views.
- Relationships are drawn in standard crow's foot notation on the canvas and in every export, so
  existing diagrams and exports look different: the circle (zero or one) sits at the referenced
  table when any key column accepts NULL, and a one-to-one key is drawn zero or one at the
  referencing table. 1.0 meant a circle at the referencing end, only when every key column
  accepted NULL, and drew it under the card, where it never showed. Exported SVG files no longer
  define the `sc-many-optional` marker and define `sc-zero-or-one` instead.
- A relationship from a table to itself loops from the referencing column to the referenced one.
- Column names in SVG exports carry their full name in a `data-column` attribute. HTML exports
  are about 43 KB larger, for the rule readers and their words.
- Projects are saved in format 2. SchemaCraft 1.1 opens and converts 1.0 projects, but a project
  saved by 1.1 needs SchemaCraft 1.1 or later.
- The status bar and the connection history name a server as `host,port` (1433 when no port
  was typed) or `host\instance`, the name remembered passwords already used.
- Reading a schema can be cancelled while it is still connecting, for example to a server that
  accepts the connection and never answers.
- A disabled button or menu item says why it is unavailable, for example that no project is open
  or that there is nothing to undo, instead of a generic note.
- The file type in the open and save dialogs follows the interface language.
- Saving projects and preferences, reading remembered passwords and comparing schemas no longer
  run on the window's thread, so the window stays responsive with large schemas or a slow disk.

### Fixed

- With a login that cannot read definitions, `CHECK` expressions no longer appear empty, columns
  with a default no longer appear to have none, and foreign keys to tables the login cannot see
  are no longer dropped without a word.
- Defaults bound with `sp_bindefault` are read instead of appearing as no default.
- A preferences file written by a newer SchemaCraft is left untouched instead of being replaced.
- A failed write of the preferences no longer changes the history shown until the next restart.
- Project, preferences and export files are flushed to the disk before they replace the previous
  file, so a power cut cannot leave an empty file behind.
- The crow's foot at the referencing end of a relationship shows; since 1.0 it was drawn under
  the referencing card, on the canvas and in every export.
- Clicking a table in an exported HTML viewer selects it; since 1.0 only its search could.

## [1.0.0] - 2026-10-14

First release.

### Added

- SQL Server inspector with SQL Server and Windows Authentication, encrypted connections, schema
  selection, cancellable extraction with progress, and actionable error messages.
- `.scraft` project files that reopen without a database, recent projects and connections,
  optional passwords kept in the Windows Credential Manager, and refresh from the database with a
  reviewed diff that keeps diagram positions.
- Diagram canvas with entity cards at three detail levels, crow's foot relationships, layered,
  organic and radial automatic layouts, manual placement, isolation of a table with its
  neighbours, undo and redo, and a command palette.
- Exports to SVG, standalone interactive HTML, single-page PDF and PNG at 1x, 2x and 4x, drawn by
  one renderer with bundled fonts.
- Bilingual interface (English and Spanish), light and dark themes, keyboard access throughout.
- Portable Windows executable and per-user installer, with a WebView2 runtime check at startup.

[Unreleased]: https://github.com/jmanuelsoberano/schemacraft/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/jmanuelsoberano/schemacraft/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/jmanuelsoberano/schemacraft/releases/tag/v1.0.0
