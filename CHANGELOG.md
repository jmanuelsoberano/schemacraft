# Changelog

All notable changes to SchemaCraft are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

### Changed

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

[1.0.0]: https://github.com/jmanuelsoberano/schemacraft/releases/tag/v1.0.0
